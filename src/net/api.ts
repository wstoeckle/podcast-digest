// The only browser module that talks to our /api endpoints.

import type {
  Digest,
  FeedResult,
  ResolveResult,
  SearchResultShow,
  TranscriptResponse,
  ChatTurn,
} from '../types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await errMessage(res)) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await errMessage(res)) || `request failed (${res.status})`);
  return (await res.json()) as T;
}

async function errMessage(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as { error?: string };
    return data.error ?? '';
  } catch {
    return '';
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

/** Stream an answer; calls onDelta for each chunk. Resolves when complete. */
export async function streamAsk(
  input: AskInput,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error((await errMessage(res)) || `ask failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) onDelta(decoder.decode(value, { stream: true }));
  }
}
