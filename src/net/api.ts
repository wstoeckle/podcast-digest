// The only browser module that talks to our /api endpoints.

import type {
  AskEvent,
  Digest,
  FeedResult,
  ResolveResult,
  SearchResultShow,
  TranscriptLink,
  TranscriptResponse,
  ChatTurn,
  OvernightStatus,
  AccessStatus,
  KeyErrorCode,
} from '../types';
import { keyHeaders } from '../lib/keys';

/**
 * A failed request. `code` is set when it's about API keys (one is needed, or
 * yours was refused), so the screen can point to Settings.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: KeyErrorCode,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The key error code of a thrown error, if it has one. */
export function keyErrorCode(err: unknown): KeyErrorCode | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

async function getJson<T>(url: string): Promise<T> {
  // Every request carries this device's own keys and owner code, if it has any.
  const res = await fetch(url, { headers: keyHeaders() });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...keyHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

async function apiError(
  res: Response,
  fallback = `request failed (${res.status})`,
): Promise<ApiError> {
  try {
    const data = (await res.clone().json()) as { error?: string; code?: string };
    const code = data.code === 'needs_key' || data.code === 'key_rejected' ? data.code : undefined;
    return new ApiError(data.error || fallback, code);
  } catch {
    return new ApiError(fallback);
  }
}

export function searchShows(q: string): Promise<{ shows: SearchResultShow[] }> {
  return getJson(`/api/search?q=${encodeURIComponent(q)}`);
}

export function fetchFeed(feedUrl: string): Promise<FeedResult> {
  return getJson(`/api/feed?url=${encodeURIComponent(feedUrl)}`);
}

export function resolveLink(url: string): Promise<ResolveResult & { error?: string }> {
  return postJson('/api/resolve', { url });
}

export interface TranscriptStart {
  guid: string;
  audioUrl?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  /** Every <podcast:transcript> in the feed, best first. */
  transcripts?: TranscriptLink[];
  /** The episode's web page, checked for a posted transcript. */
  link?: string;
  /** Lets the server tell a whole transcript from show notes. */
  durationSec?: number;
  /** A transcript the user pasted in — skips STT, wins over everything. */
  transcript?: string;
}

export function startTranscript(input: TranscriptStart): Promise<TranscriptResponse> {
  return postJson('/api/transcript', input);
}

export function pollTranscript(guid: string, jobId?: string): Promise<TranscriptResponse> {
  const q = jobId ? `&jobId=${encodeURIComponent(jobId)}` : '';
  return getJson(`/api/transcript?guid=${encodeURIComponent(guid)}${q}`);
}

export interface DigestInput {
  guid: string;
  transcript?: string;
  showTitle?: string;
  episodeTitle?: string;
}

export function getDigest(input: DigestInput): Promise<Digest> {
  return postJson('/api/digest', input);
}

export interface AskInput {
  guid?: string;
  transcript?: string;
  showTitle?: string;
  episodeTitle?: string;
  history: ChatTurn[];
  question: string;
}

/**
 * Stream an answer. The response is newline-delimited JSON (AskEvent): text
 * chunks, and the transcript passages they cite. Resolves when complete.
 */
export async function streamAsk(
  input: AskInput,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...keyHeaders() },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) throw await apiError(res, `ask failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as AskEvent);
    } catch {
      /* a malformed line is skipped rather than ending the answer */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      emit(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  emit(buffer + decoder.decode());
}

export function recommendDigests(
  input: import('../lib/listening').RecommendationInput,
): Promise<import('../lib/listening').RecommendationResult> {
  return postJson('/api/recommend', input);
}

export function getOvernight(): Promise<OvernightStatus> {
  return getJson('/api/overnight');
}

export type OvernightSync =
  | { action: 'add'; shows: { feedUrl: string; title: string; artwork?: string }[] }
  | { action: 'remove'; feedUrls: string[] }
  | { action: 'clear' };

export function syncOvernight(body: OvernightSync): Promise<OvernightStatus> {
  return postJson('/api/overnight', body);
}

/** Whose keys this device uses; with `check`, whether its own keys work (free calls). */
export function getAccess(check = false): Promise<AccessStatus> {
  return getJson(`/api/access${check ? '?check=1' : ''}`);
}
