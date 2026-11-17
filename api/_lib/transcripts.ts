// Transcript storage and fetching shared by /api/transcript and the overnight
// digests. Transcripts are stored as timed text when the source has times
// (see src/lib/timed.ts).

import { MAX_TRANSCRIPT_CHARS, PROMPT_VERSION } from '../../src/lib/digestPrompt.js';
import { toTimedTranscript } from '../../src/lib/transcriptFormats.js';
import { fetchWithTimeout } from './http.js';
import { CACHE_TTL_SECONDS, redis } from './redis.js';

export const transcriptKey = (guid: string) => `t:${guid}`;

export async function getCachedTranscript(guid: string): Promise<string | null> {
  const kv = redis();
  if (!kv) return null;
  return (await kv.get<string>(transcriptKey(guid))) ?? null;
}

export async function putCachedTranscript(guid: string, text: string): Promise<void> {
  const kv = redis();
  if (kv) await kv.set(transcriptKey(guid), text, { ex: CACHE_TTL_SECONDS });
}

/** Fetch a published (RSS) transcript file and convert it, keeping times. */
export async function fetchTranscriptFile(url: string, type?: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(url, 15000);
    if (!r.ok) return null;
    const raw = await r.text();
    const ct = type ?? r.headers.get('content-type') ?? undefined;
    const text = toTimedTranscript(raw, ct).slice(0, MAX_TRANSCRIPT_CHARS);
    return text.length > 40 ? text : null;
  } catch {
    return null;
  }
}

/** Cached digests are keyed by prompt version, so a prompt change regenerates them. */
export const digestKey = (guid: string) => `d:${PROMPT_VERSION}:${guid}`;
