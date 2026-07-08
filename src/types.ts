// Shared types used by both the browser (src/net, pages) and the serverless
// API (api/*). Keep this DOM/Node-free.

export interface Show {
  /** Stable id — the feed URL is the source of truth; iTunes collectionId when known. */
  id: string;
  title: string;
  author?: string;
  artwork?: string;
  feedUrl: string;
  description?: string;
}

export interface Episode {
  /** RSS <guid>, or a hash of the audio URL when a feed omits guids. */
  guid: string;
  title: string;
  audioUrl?: string;
  durationSec?: number;
  /** ISO date string. */
  publishedAt?: string;
  description?: string;
  /** From a Podcasting-2.0 <podcast:transcript> tag, if present. */
  transcriptUrl?: string;
  transcriptType?: string;
}

export interface FeedResult {
  show: Show;
  episodes: Episode[];
}

export interface SearchResultShow {
  id: string;
  title: string;
  author?: string;
  artwork?: string;
  feedUrl: string;
}

/** What a pasted link resolves to. */
export interface ResolveResult {
  feedUrl?: string;
  guid?: string;
  /** A bare audio URL the user pasted, when we couldn't find a feed. */
  audioUrl?: string;
  kind: 'feed' | 'apple' | 'pocketcasts' | 'spotify' | 'audio' | 'unknown';
}

export type TranscriptStatus = 'processing' | 'ready' | 'error';

export interface TranscriptResponse {
  status: TranscriptStatus;
  /** Present when status === 'ready'. */
  text?: string;
  /** How we obtained it, for the UI. */
  source?: 'cache' | 'rss' | 'stt' | 'demo' | 'pasted';
  /** STT job id to poll with (status === 'processing'); client echoes it back. */
  jobId?: string;
  error?: string;
}

export interface Digest {
  tldr: string;
  bullets: string[];
  topics: string[];
  /** True when produced by demo mode (no ANTHROPIC_API_KEY). */
  demo?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
