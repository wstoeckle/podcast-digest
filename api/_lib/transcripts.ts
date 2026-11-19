// Transcript storage and fetching shared by /api/transcript and the overnight
// digests. Transcripts are stored as timed text when the source has times
// (see src/lib/timed.ts).
//
// Before paying to transcribe, findExistingTranscript looks for one that
// already exists: every <podcast:transcript> file in the feed (best format
// first), then the episode's web page, a same-site transcript page it links
// to, or NPR's transcript page.

import type { TranscriptLink } from '../../src/types.js';
import { MAX_TRANSCRIPT_CHARS, PROMPT_VERSION } from '../../src/lib/digestPrompt.js';
import {
  nprTranscriptUrl,
  sameSiteTranscriptLinks,
  transcriptFromPage,
} from '../../src/lib/pageTranscript.js';
import { toTimedTranscript } from '../../src/lib/transcriptFormats.js';
import { fetchWithTimeout, safeRemoteUrl } from './http.js';
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

/** Where an existing transcript might be, from the episode's feed entry. */
export interface TranscriptSources {
  transcripts?: TranscriptLink[] | undefined;
  transcriptUrl?: string | undefined;
  transcriptType?: string | undefined;
  /** The episode's web page. */
  link?: string | undefined;
  durationSec?: number | undefined;
}

export interface FoundTranscript {
  text: string;
  source: 'rss' | 'web';
}

/** Pages bigger than this aren't worth reading (a transcript page is ~0.5 MB). */
const MAX_PAGE_BYTES = 5_000_000;

/** A transcript that already exists for the episode, or null. Never throws. */
export async function findExistingTranscript(
  src: TranscriptSources,
): Promise<FoundTranscript | null> {
  const files: TranscriptLink[] = src.transcripts?.length
    ? src.transcripts
    : src.transcriptUrl
      ? [
          src.transcriptType
            ? { url: src.transcriptUrl, type: src.transcriptType }
            : { url: src.transcriptUrl },
        ]
      : [];
  for (const f of files.slice(0, 4)) {
    const url = safeRemoteUrl(f.url);
    if (!url) continue;
    const text = await fetchTranscriptFile(url.toString(), f.type);
    if (text) return { text, source: 'rss' };
  }
  const web = await findWebTranscript(src.link, src.durationSec);
  return web ? { text: web, source: 'web' } : null;
}

async function findWebTranscript(
  link: string | undefined,
  durationSec?: number,
): Promise<string | null> {
  const page = safeRemoteUrl(link);
  if (!page) return null;
  const candidates: string[] = [];
  // NPR's episode pages never carry the transcript; go straight to it.
  const npr = nprTranscriptUrl(page.toString());
  if (npr) {
    candidates.push(npr);
  } else {
    const html = await fetchPage(page.toString());
    if (!html) return null;
    const own = transcriptFromPage(html, durationSec);
    if (own) return finish(own);
    candidates.push(...sameSiteTranscriptLinks(html, page.toString()));
  }
  for (const url of candidates) {
    const html = await fetchPage(url);
    const text = html ? transcriptFromPage(html, durationSec) : null;
    if (text) return finish(text);
  }
  return null;
}

/** Keep the page's timestamps when it has them (Lex Fridman's do). */
function finish(text: string): string {
  return toTimedTranscript(text, 'text/plain').slice(0, MAX_TRANSCRIPT_CHARS);
}

async function fetchPage(url: string): Promise<string | null> {
  const safe = safeRemoteUrl(url);
  if (!safe) return null;
  try {
    const r = await fetchWithTimeout(safe.toString(), 10000);
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    if (type && !/html|text/i.test(type)) return null;
    const size = Number(r.headers.get('content-length') ?? 0);
    if (size > MAX_PAGE_BYTES) return null;
    return (await r.text()).slice(0, MAX_PAGE_BYTES);
  } catch {
    return null;
  }
}

/** Cached digests are keyed by prompt version, so a prompt change regenerates them. */
export const digestKey = (guid: string) => `d:${PROMPT_VERSION}:${guid}`;
