// POST /api/ask { guid?, transcript?, showTitle?, episodeTitle?, history?, question }
// Streams an answer grounded in the episode transcript, as newline-delimited
// JSON events: text chunks and the transcript passages they cite. The transcript
// is prompt-cached inside anthropic.ts so follow-ups in a session stay cheap.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AskEvent, ChatTurn } from '../src/types.js';
import { streamAnswer } from './_lib/anthropic.js';
import { jsonBody, methodNotAllowed, str } from './_lib/http.js';
import { llmGlobalPerHour, llmPerHour, rateLimit, tooMany } from './_lib/ratelimit.js';
import { getCachedTranscript } from './_lib/transcripts.js';

// Input-size ceilings: the transcript is already clamped in anthropic.ts, but
// an unbounded question or history would let one request smuggle megabytes of
// extra input tokens past the rate limit. Generous for real use, hard caps for
// abuse.
const MAX_QUESTION_CHARS = 4_000;
const MAX_TURN_CHARS = 8_000;

function toHistory(v: unknown): ChatTurn[] {
  if (!Array.isArray(v)) return [];
  const out: ChatTurn[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const role = (item as Record<string, unknown>).role;
      const content = (item as Record<string, unknown>).content;
      if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content) {
        out.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
      }
    }
  }
  return out.slice(-12); // keep the last few turns
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const body = jsonBody(req);
  const question = str(body.question)?.slice(0, MAX_QUESTION_CHARS);
  if (!question) {
    res.status(400).json({ error: 'missing question' });
    return;
  }

  const guid = str(body.guid);
  const transcript = str(body.transcript) ?? (guid ? await getCachedTranscript(guid) : null);
  if (!transcript) {
    res.status(400).json({ error: 'no transcript available for this episode' });
    return;
  }

  const meta = { showTitle: str(body.showTitle), episodeTitle: str(body.episodeTitle) };
  const history = toHistory(body.history);

  // Every question is a model call — meter before we start streaming.
  const rl = await rateLimit(req, {
    name: 'llm',
    perHour: llmPerHour(),
    globalPerHour: llmGlobalPerHour(),
  });
  if (rl && !rl.ok) return tooMany(res, rl);

  // Newline-delimited JSON: text chunks and the transcript passages they cite.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (event: AskEvent) => res.write(`${JSON.stringify(event)}\n`);

  try {
    await streamAnswer({ transcript, meta, history, question, onEvent: send });
  } catch (err) {
    if (!res.writableEnded) send({ type: 'error', message: (err as Error).message });
  }
  res.end();
}
