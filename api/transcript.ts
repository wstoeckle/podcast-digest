// Transcript pipeline.
//   POST /api/transcript { guid, audioUrl?, transcripts?, link?, durationSec?, … }
//     → cache-first, then a transcript the show already published (the feed's
//       transcript files, then its website), else kick off STT.
//   GET  /api/transcript?guid=...&jobId=...
//     → poll a running STT job; caches the text on completion.
//
// STT job tracking uses a client-echoed jobId, so this works with or without
// Redis (Redis only caches the final text to avoid re-transcribing).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { TranscriptLink, TranscriptResponse } from '../src/types.js';
import { toTimedTranscript } from '../src/lib/transcriptFormats.js';
import { DEMO_TRANSCRIPT, MAX_TRANSCRIPT_CHARS } from '../src/lib/digestPrompt.js';
import { jsonBody, methodNotAllowed, safeRemoteUrl, str } from './_lib/http.js';
import { rateLimit, sttGlobalPerHour, sttPerHour, tooMany } from './_lib/ratelimit.js';
import { hasStt, sttProvider } from './_lib/stt.js';
import {
  findExistingTranscript,
  getCachedTranscript as getCached,
  putCachedTranscript as putCached,
} from './_lib/transcripts.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return void (await pollJob(req, res));
  if (req.method === 'POST') return void (await startOrReturn(req, res));
  return methodNotAllowed(res, 'GET, POST');
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
    // Keeps timestamps when the pasted text has them, so the outline can link into the audio.
    const text = toTimedTranscript(pasted).slice(0, MAX_TRANSCRIPT_CHARS);
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
    res
      .status(200)
      .json({ status: 'ready', text: cached, source: 'cache' } satisfies TranscriptResponse);
    return;
  }

  // 1) A transcript that already exists — free: the feed's transcript files,
  // then the show's website. Only if there's none do we pay to transcribe.
  const found = await findExistingTranscript({
    transcripts: transcriptLinks(body.transcripts),
    transcriptUrl: str(body.transcriptUrl),
    transcriptType: str(body.transcriptType),
    link: str(body.link),
    durationSec: typeof body.durationSec === 'number' ? body.durationSec : undefined,
  });
  if (found) {
    await putCached(guid, found.text);
    res
      .status(200)
      .json({
        status: 'ready',
        text: found.text,
        source: found.source,
      } satisfies TranscriptResponse);
    return;
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
    res
      .status(200)
      .json({ status: 'ready', text: cached, source: 'cache' } satisfies TranscriptResponse);
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
      res
        .status(200)
        .json({ status: 'ready', text: result.text, source: 'stt' } satisfies TranscriptResponse);
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

/** The feed's transcript links as the client sent them (at most a handful). */
function transcriptLinks(v: unknown): TranscriptLink[] {
  if (!Array.isArray(v)) return [];
  const out: TranscriptLink[] = [];
  for (const item of v.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const url = str((item as Record<string, unknown>).url);
    const type = str((item as Record<string, unknown>).type);
    if (url) out.push(type ? { url, type } : { url });
  }
  return out;
}
