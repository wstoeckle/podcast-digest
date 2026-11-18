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

export interface OutlineItem {
  title: string;
  summary: string;
  /** Seconds into the episode, when the transcript has times. */
  start?: number;
}

export interface Quote {
  text: string;
  /** Seconds into the episode, when the transcript has times. */
  start?: number;
}

export interface Digest {
  tldr: string;
  bullets: string[];
  topics: string[];
  /** The episode's segments in order. Absent on digests made before v2. */
  outline?: OutlineItem[];
  /** Short lines verified to appear word for word in the transcript. Absent before v2. */
  quotes?: Quote[];
  /** True when produced by demo mode (no ANTHROPIC_API_KEY). */
  demo?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** A transcript passage an answer is based on. */
export interface Citation {
  /** The exact transcript text, without time markers. */
  text: string;
  /** Seconds into the episode, when the transcript has times. */
  start?: number;
}

/** One line of the /api/ask stream (newline-delimited JSON). */
export type AskEvent =
  | { type: 'text'; text: string }
  | ({ type: 'cite' } & Citation)
  | { type: 'error'; message: string };

/** A digest made overnight for a new episode of a followed show. */
export interface OvernightItem {
  guid: string;
  feedUrl: string;
  showTitle: string;
  episodeTitle: string;
  publishedAt?: string;
  artwork?: string;
  tldr: string;
  /** epoch ms */
  digestedAt: number;
}

/** A show picked for overnight digests. */
export interface OvernightShow {
  feedUrl: string;
  title: string;
  artwork?: string;
}

/** GET /api/overnight. */
export interface OvernightStatus {
  /** False when the server lacks what overnight digests need (reason says what). */
  available: boolean;
  reason?: string;
  /** True when the nightly run is set up (CRON_SECRET is configured). */
  scheduled: boolean;
  /** Shows the server checks each night. */
  following: number;
  /** The shows picked for overnight digests (the server keeps the list). */
  shows: OvernightShow[];
  /** Episodes being transcribed or digested right now. */
  pending: number;
  /** epoch ms of the last nightly run. */
  lastRunAt?: number;
  items: OvernightItem[];
}
