// Transcript pipeline.
//   POST /api/transcript { guid, audioUrl?, transcriptUrl?, transcriptType? }
//     → cache-first, then a published RSS transcript, else kick off STT.
//   GET  /api/transcript?guid=...&jobId=...
//     → poll a running STT job; caches the text on completion.
//
// STT job tracking uses a client-echoed jobId, so this works with or without
// Redis (Redis only caches the final text to avoid re-transcribing).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { TranscriptResponse } from '../src/types';
import { toPlainTranscript } from '../src/lib/transcriptFormats.js';
import { DEMO_TRANSCRIPT, MAX_TRANSCRIPT_CHARS } from '../src/lib/digestPrompt.js';
import { fetchWithTimeout, jsonBody, methodNotAllowed, safeRemoteUrl, str } from './_lib/http.js';
import { rateLimit, sttGlobalPerHour, sttPerHour, tooMany } from './_lib/ratelimit.js';
import { CACHE_TTL_SECONDS, redis } from './_lib/redis.js';
import { hasStt, sttProvider } from './_lib/stt.js';

const cacheKey = (guid: string) => `t:${guid}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return void (await pollJob(req, res));
  if (req.method === 'POST') return void (await startOrReturn(req, res));
  return methodNotAllowed(res, 'GET, POST');
}

async function getCached(guid: string): Promise<string | null> {
  const kv = redis();
  if (!kv) return null;
  return (await kv.get<string>(cacheKey(guid))) ?? null;
}

async function putCached(guid: string, text: string): Promise<void> {
  const kv = redis();
  if (kv) await kv.set(cacheKey(guid), text, { ex: CACHE_TTL_SECONDS });
}

async function startOrReturn(req: VercelRequest, res: VercelResponse) {
  const body = jsonBody(req);
  const guid = str(body.guid);
  if (!guid) {
    res.status(400).json({ status: 'error', error: 'missing guid' } satisfies TranscriptResponse);
    return;
  }

  // 0) A transcript the user pasted in wins over everything and refreshes the
  // cache. This lets people digest shows whose transcripts live on the web but
  // not in the RSS feed, and skips STT entirely — free, instant, and higher
  // quality than machine transcription. It's also how you fix a bad auto-transcript.
  // Clamp before caching: anything past the model's ceiling would only bloat
  // Redis (the model input is clamped again in anthropic.ts regardless).
  const pasted = str(body.transcript)?.slice(0, MAX_TRANSCRIPT_CHARS * 2);
  if (pasted) {
    const text = toPlainTranscript(pasted).slice(0, MAX_TRANSCRIPT_CHARS);
    if (text.length < 40) {
      res.status(400).json({
        status: 'error',
        error: 'That transcript looks too short — paste the full text.',
      } satisfies TranscriptResponse);
      return;
    }
    await putCached(guid, text);
    res.status(200).json({ status: 'ready', text, source: 'pasted' } satisfies TranscriptResponse);
    return;
  }

  const cached = await getCached(guid);
  if (cached) {
    res.status(200).json({ status: 'ready', text: cached, source: 'cache' } satisfies TranscriptResponse);
    return;
  }

  // 1) A transcript published in the RSS feed — free and instant.
  const transcriptUrl = safeRemoteUrl(str(body.transcriptUrl));
  if (transcriptUrl) {
    const text = await fetchTranscriptFile(transcriptUrl.toString(), str(body.transcriptType));
    if (text) {
      await putCached(guid, text);
      res.status(200).json({ status: 'ready', text, source: 'rss' } satisfies TranscriptResponse);
      return;
    }
  }

  // 2) No key configured → demo transcript so the flow stays clickable.
  if (!hasStt()) {
    res.status(200).json({
      status: 'ready',
      text: DEMO_TRANSCRIPT,
      source: 'demo',
    } satisfies TranscriptResponse);
    return;
  }

  // 3) Transcribe the audio via the STT provider (URL ingest, submit → poll).
  const audioUrl = safeRemoteUrl(str(body.audioUrl));
  const provider = sttProvider();
  if (!audioUrl || !provider) {
    res.status(400).json({
      status: 'error',
      error: 'no transcript available and no audio URL to transcribe',
    } satisfies TranscriptResponse);
    return;
  }

  // Submitting a job is the credit-consuming action — meter it here so cache /
  // RSS-transcript / demo responses above never count against the budget.
  const rl = await rateLimit(req, {
    name: 'stt',
    perHour: sttPerHour(),
    globalPerHour: sttGlobalPerHour(),
  });
  if (rl && !rl.ok) return tooMany(res, rl);

  try {
    const jobId = await provider.submit(audioUrl.toString());
    res.status(200).json({ status: 'processing', jobId } satisfies TranscriptResponse);
  } catch (err) {
    res
      .status(502)
      .json({ status: 'error', error: (err as Error).message } satisfies TranscriptResponse);
  }
}

async function pollJob(req: VercelRequest, res: VercelResponse) {
  const guid = str(req.query.guid);
  if (!guid) {
    res.status(400).json({ status: 'error', error: 'missing guid' } satisfies TranscriptResponse);
    return;
  }

  const cached = await getCached(guid);
  if (cached) {
    res.status(200).json({ status: 'ready', text: cached, source: 'cache' } satisfies TranscriptResponse);
    return;
  }

  const jobId = str(req.query.jobId);
  const provider = sttProvider();
  if (!jobId || !provider) {
    res.status(200).json({ status: 'processing' } satisfies TranscriptResponse);
    return;
  }

  try {
    const result = await provider.poll(jobId);
    if (result.status === 'ready' && result.text) {
      await putCached(guid, result.text);
      res.status(200).json({ status: 'ready', text: result.text, source: 'stt' } satisfies TranscriptResponse);
      return;
    }
    const out: TranscriptResponse = { status: result.status };
    if (result.status === 'processing') out.jobId = jobId;
    if (result.error) out.error = result.error;
    res.status(200).json(out);
  } catch (err) {
    res
      .status(502)
      .json({ status: 'error', error: (err as Error).message } satisfies TranscriptResponse);
  }
}

async function fetchTranscriptFile(url: string, type?: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(url, 15000);
    if (!r.ok) return null;
    const raw = await r.text();
    const ct = type ?? r.headers.get('content-type') ?? undefined;
    const text = toPlainTranscript(raw, ct).slice(0, MAX_TRANSCRIPT_CHARS);
    return text.length > 40 ? text : null;
  } catch {
    return null;
  }
}
