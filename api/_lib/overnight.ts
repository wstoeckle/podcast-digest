// Overnight digests: each night, find new episodes of the shows you follow,
// get their transcripts, and digest them in one Message Batch (half price).
// When you next open the app, finished batches are collected and the digests
// are waiting — opening one is a cache hit.
//
// State lives in Redis (keys below), and every outside call goes through
// OvernightDeps, so the whole pipeline runs in tests against fakes.
//
//   nightly (cron): collect finished batches → discover new episodes → wait
//                   briefly for transcriptions → submit a batch
//   collect (app open, at most once a minute): collect finished batches →
//                   check transcriptions once → submit a batch for ready ones

import { createHash } from 'node:crypto';
import type {
  Digest,
  FeedResult,
  OvernightItem,
  OvernightShow,
  OvernightStatus,
} from '../../src/types.js';
import {
  MAX_TRANSCRIPT_CHARS,
  groundDigest,
  type EpisodeMeta,
} from '../../src/lib/digestPrompt.js';
import type { TranscriptStatus } from '../../src/types.js';
import { digestKey, transcriptKey, type TranscriptSources } from './transcripts.js';

/** The Redis operations the pipeline uses (see redisStore in api/overnight.ts). */
export interface OvernightStore {
  get<T>(key: string): Promise<T | null>;
  /** Returns false when `nx` is set and the key already exists. */
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  hset(key: string, values: Record<string, unknown>): Promise<void>;
  hdel(key: string, fields: string[]): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  sadd(key: string, members: string[]): Promise<void>;
  srem(key: string, members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;
  lpush(key: string, value: unknown): Promise<void>;
  ltrim(key: string, start: number, end: number): Promise<void>;
  lrange<T>(key: string, start: number, end: number): Promise<T[]>;
}

export interface BatchDigestResult {
  customId: string;
  digest?: Digest;
  error?: string;
}

export interface OvernightDeps {
  store: OvernightStore;
  now(): number;
  sleep(ms: number): Promise<void>;
  fetchFeed(url: string): Promise<FeedResult | null>;
  /** A transcript the show already published (feed file or episode web page). */
  findTranscript(sources: TranscriptSources): Promise<string | null>;
  stt: {
    submit(audioUrl: string): Promise<string>;
    poll(jobId: string): Promise<{ status: TranscriptStatus; text?: string; error?: string }>;
  } | null;
  claude: {
    createBatch(
      items: { customId: string; transcript: string; meta: EpisodeMeta }[],
    ): Promise<string>;
    /** null while the batch is still running. */
    readBatch(batchId: string): Promise<BatchDigestResult[] | null>;
  };
  log(event: Record<string, unknown>): void;
}

export interface OvernightConfig {
  /** Most new episodes taken per night. */
  maxEpisodes: number;
  /** Most of those transcribed from audio (the rest need a published transcript). */
  maxTranscribe: number;
}

export interface FeedEntry {
  title: string;
  artwork?: string;
  addedAt: number;
}

interface OvEpisode {
  id: string;
  guid: string;
  feedUrl: string;
  showTitle: string;
  episodeTitle: string;
  publishedAt?: string;
  artwork?: string;
  stage: 'stt' | 'ready' | 'batched' | 'done' | 'skipped' | 'failed';
  jobId?: string;
  batchId?: string;
}

export interface RunSummary {
  skipped?: string;
  collected: number;
  discovered: number;
  transcribing: number;
  batched: number;
  failed: number;
}

export const KEYS = {
  feeds: 'ov:feeds',
  ep: (id: string) => `ov:ep:${id}`,
  stt: 'ov:stt',
  ready: 'ov:ready',
  batches: 'ov:batches',
  pending: 'ov:pending',
  fresh: 'ov:fresh',
  lock: 'ov:lock',
  lastRun: 'ov:lastRun',
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const EPISODE_TTL_SECONDS = 7 * 24 * 3600;
const CACHE_TTL_SECONDS = 30 * 24 * 3600;
export const MAX_FEEDS = 200;
const PER_SHOW_PER_NIGHT = 2;
const FRESH_KEEP = 30;
const STT_POLL_MS = 15_000;

/** A Batch custom_id: 1-64 of [A-Za-z0-9_-]. Guids can be anything. */
export function episodeId(guid: string): string {
  return createHash('sha256').update(guid).digest('hex').slice(0, 32);
}

// ---- Followed shows ---------------------------------------------------------

export async function addFeeds(
  store: OvernightStore,
  shows: { feedUrl: string; title: string; artwork?: string }[],
  now: number,
): Promise<void> {
  const existing = await store.hgetall<FeedEntry>(KEYS.feeds);
  const values: Record<string, FeedEntry> = {};
  let count = Object.keys(existing).length;
  for (const s of shows) {
    if (!existing[s.feedUrl] && count >= MAX_FEEDS) continue;
    if (!existing[s.feedUrl]) count++;
    values[s.feedUrl] = {
      title: s.title,
      ...(s.artwork ? { artwork: s.artwork } : {}),
      addedAt: existing[s.feedUrl]?.addedAt ?? now,
    };
  }
  if (Object.keys(values).length) await store.hset(KEYS.feeds, values);
}

export async function removeFeeds(store: OvernightStore, feedUrls: string[]): Promise<void> {
  if (feedUrls.length) await store.hdel(KEYS.feeds, feedUrls);
}

export async function clearFeeds(store: OvernightStore): Promise<void> {
  await store.del(KEYS.feeds);
}

export async function overnightStatus(
  store: OvernightStore,
  opts: { scheduled: boolean; now: number },
): Promise<OvernightStatus> {
  const [feeds, items, pending, lastRun] = await Promise.all([
    store.hgetall<FeedEntry>(KEYS.feeds),
    store.lrange<OvernightItem>(KEYS.fresh, 0, FRESH_KEEP - 1),
    store.smembers(KEYS.pending),
    store.get<number>(KEYS.lastRun),
  ]);
  const shows: OvernightShow[] = Object.entries(feeds)
    .map(([feedUrl, f]) =>
      f.artwork ? { feedUrl, title: f.title, artwork: f.artwork } : { feedUrl, title: f.title },
    )
    .sort((a, b) => a.title.localeCompare(b.title));
  return {
    available: true,
    scheduled: opts.scheduled,
    following: shows.length,
    shows,
    pending: pending.length,
    ...(lastRun ? { lastRunAt: lastRun } : {}),
    items: items.filter((i) => opts.now - i.digestedAt < 7 * DAY),
  };
}

// ---- The run ----------------------------------------------------------------

export async function runOvernight(
  deps: OvernightDeps,
  cfg: OvernightConfig,
  mode: 'nightly' | 'collect',
  /** Wall-clock budget for the run (the function's maxDuration, less a margin). */
  budgetMs = 240_000,
): Promise<RunSummary> {
  const { store } = deps;
  const summary: RunSummary = {
    collected: 0,
    discovered: 0,
    transcribing: 0,
    batched: 0,
    failed: 0,
  };
  const start = deps.now();
  if (!(await store.set(KEYS.lock, start, { nx: true, ex: 290 }))) {
    return { ...summary, skipped: 'another run is in progress' };
  }
  try {
    await collectBatches(deps, summary);
    if (mode === 'nightly') {
      await discover(deps, cfg, summary);
      await store.set(KEYS.lastRun, start);
    }
    await pollTranscriptions(deps, summary, mode === 'nightly' ? start + budgetMs : 0);
    await submitReady(deps, summary);
    return summary;
  } finally {
    await store.del(KEYS.lock);
  }
}

async function saveEpisode(store: OvernightStore, ep: OvEpisode): Promise<void> {
  await store.set(KEYS.ep(ep.id), ep, { ex: EPISODE_TTL_SECONDS });
}

async function finish(
  store: OvernightStore,
  ep: OvEpisode,
  stage: 'done' | 'failed',
): Promise<void> {
  await saveEpisode(store, { ...ep, stage });
  await store.srem(KEYS.pending, [ep.id]);
}

/** Find episodes published since the last run and start getting their transcripts. */
async function discover(
  deps: OvernightDeps,
  cfg: OvernightConfig,
  summary: RunSummary,
): Promise<void> {
  const { store } = deps;
  const now = deps.now();
  const feeds = await store.hgetall<FeedEntry>(KEYS.feeds);
  const urls = Object.keys(feeds).slice(0, MAX_FEEDS);
  if (!urls.length) return;

  const lastRun = await store.get<number>(KEYS.lastRun);
  const since = Math.max(now - 7 * DAY, lastRun ? lastRun - 6 * HOUR : now - 36 * HOUR);

  const parsed = await mapLimit(urls, 6, (url) => deps.fetchFeed(url).catch(() => null));
  interface Candidate {
    ep: OvEpisode;
    audioUrl?: string | undefined;
    sources: TranscriptSources;
  }
  const candidates: Candidate[] = [];
  parsed.forEach((feed, i) => {
    const feedUrl = urls[i];
    if (!feed || !feedUrl) return;
    const fresh = feed.episodes
      .filter((e) => e.publishedAt && Date.parse(e.publishedAt) >= since)
      .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''))
      .slice(0, PER_SHOW_PER_NIGHT);
    for (const e of fresh) {
      const artwork = feed.show.artwork ?? feeds[feedUrl]?.artwork;
      candidates.push({
        ep: {
          id: episodeId(e.guid),
          guid: e.guid,
          feedUrl,
          showTitle: feed.show.title,
          episodeTitle: e.title,
          ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
          ...(artwork ? { artwork } : {}),
          stage: 'skipped',
        },
        audioUrl: e.audioUrl,
        sources: {
          transcripts: e.transcripts,
          transcriptUrl: e.transcriptUrl,
          transcriptType: e.transcriptType,
          link: e.link,
          durationSec: e.durationSec,
        },
      });
    }
  });
  const published = (c: Candidate) => Date.parse(c.ep.publishedAt ?? '');
  candidates.sort((a, b) => published(b) - published(a));

  let taken = 0;
  for (const { ep, audioUrl, sources } of candidates) {
    if (taken >= cfg.maxEpisodes) break;
    if ((await store.exists(KEYS.ep(ep.id))) || (await store.exists(digestKey(ep.guid)))) continue;

    let transcript = await store.get<string>(transcriptKey(ep.guid));
    if (!transcript) {
      transcript = await deps.findTranscript(sources).catch(() => null);
      if (transcript)
        await store.set(transcriptKey(ep.guid), transcript, { ex: CACHE_TTL_SECONDS });
    }
    if (transcript) {
      await saveEpisode(store, { ...ep, stage: 'ready' });
      await store.sadd(KEYS.ready, [ep.id]);
      await store.sadd(KEYS.pending, [ep.id]);
      taken++;
      summary.discovered++;
      continue;
    }
    if (deps.stt && audioUrl && summary.transcribing < cfg.maxTranscribe) {
      try {
        const jobId = await deps.stt.submit(audioUrl);
        await saveEpisode(store, { ...ep, stage: 'stt', jobId });
        await store.sadd(KEYS.stt, [ep.id]);
        await store.sadd(KEYS.pending, [ep.id]);
        taken++;
        summary.discovered++;
        summary.transcribing++;
      } catch (err) {
        deps.log({
          event: 'overnight_stt_submit_failed',
          guid: ep.guid,
          error: (err as Error).message,
        });
      }
      continue;
    }
    // No transcript and no transcription budget: note it so it isn't rechecked every night.
    await saveEpisode(store, { ...ep, stage: 'skipped' });
  }
}

/** Check running transcriptions; in a nightly run, keep checking until the deadline. */
async function pollTranscriptions(
  deps: OvernightDeps,
  summary: RunSummary,
  deadline: number,
): Promise<void> {
  const { store, stt } = deps;
  if (!stt) return;
  for (;;) {
    const ids = await store.smembers(KEYS.stt);
    if (!ids.length) return;
    for (const id of ids) {
      const ep = await store.get<OvEpisode>(KEYS.ep(id));
      if (!ep?.jobId) {
        await store.srem(KEYS.stt, [id]);
        await store.srem(KEYS.pending, [id]);
        continue;
      }
      const r = await stt.poll(ep.jobId).catch(() => null);
      if (r?.status === 'ready' && r.text) {
        await store.set(transcriptKey(ep.guid), r.text.slice(0, MAX_TRANSCRIPT_CHARS), {
          ex: CACHE_TTL_SECONDS,
        });
        await saveEpisode(store, { ...ep, stage: 'ready' });
        await store.srem(KEYS.stt, [id]);
        await store.sadd(KEYS.ready, [id]);
      } else if (r?.status === 'error') {
        await store.srem(KEYS.stt, [id]);
        await finish(store, ep, 'failed');
        summary.failed++;
      }
    }
    if (deps.now() + STT_POLL_MS > deadline) return;
    await deps.sleep(STT_POLL_MS);
  }
}

/** Send every episode with a transcript in one batch. */
async function submitReady(deps: OvernightDeps, summary: RunSummary): Promise<void> {
  const { store } = deps;
  const ids = await store.smembers(KEYS.ready);
  const items: { customId: string; transcript: string; meta: EpisodeMeta; ep: OvEpisode }[] = [];
  for (const id of ids) {
    const ep = await store.get<OvEpisode>(KEYS.ep(id));
    const transcript = ep ? await store.get<string>(transcriptKey(ep.guid)) : null;
    if (!ep || !transcript) {
      await store.srem(KEYS.ready, [id]);
      await store.srem(KEYS.pending, [id]);
      continue;
    }
    items.push({
      customId: id,
      transcript,
      meta: { showTitle: ep.showTitle, episodeTitle: ep.episodeTitle },
      ep,
    });
  }
  if (!items.length) return;
  let batchId: string;
  try {
    batchId = await deps.claude.createBatch(items.map(({ ep: _ep, ...item }) => item));
  } catch (err) {
    // Left in the ready set; the next run tries again.
    deps.log({ event: 'overnight_batch_failed', error: (err as Error).message });
    return;
  }
  for (const { ep } of items) {
    await saveEpisode(store, { ...ep, stage: 'batched', batchId });
    await store.srem(KEYS.ready, [ep.id]);
  }
  await store.sadd(KEYS.batches, [batchId]);
  summary.batched += items.length;
}

/** Store the digests from every batch that has finished. */
async function collectBatches(deps: OvernightDeps, summary: RunSummary): Promise<void> {
  const { store } = deps;
  for (const batchId of await store.smembers(KEYS.batches)) {
    const results = await deps.claude.readBatch(batchId).catch((err: Error) => {
      deps.log({ event: 'overnight_collect_failed', batchId, error: err.message });
      return null;
    });
    if (!results) continue;
    for (const r of results) {
      const ep = await store.get<OvEpisode>(KEYS.ep(r.customId));
      if (!ep) continue;
      if (!r.digest) {
        deps.log({ event: 'overnight_digest_failed', guid: ep.guid, error: r.error });
        await finish(store, ep, 'failed');
        summary.failed++;
        continue;
      }
      const transcript = await store.get<string>(transcriptKey(ep.guid));
      const digest = transcript ? groundDigest(r.digest, transcript) : r.digest;
      await store.set(digestKey(ep.guid), digest, { ex: CACHE_TTL_SECONDS });
      const item: OvernightItem = {
        guid: ep.guid,
        feedUrl: ep.feedUrl,
        showTitle: ep.showTitle,
        episodeTitle: ep.episodeTitle,
        ...(ep.publishedAt ? { publishedAt: ep.publishedAt } : {}),
        ...(ep.artwork ? { artwork: ep.artwork } : {}),
        tldr: digest.tldr,
        digestedAt: deps.now(),
      };
      await store.lpush(KEYS.fresh, item);
      await finish(store, ep, 'done');
      summary.collected++;
    }
    await store.ltrim(KEYS.fresh, 0, FRESH_KEEP - 1);
    await store.srem(KEYS.batches, [batchId]);
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}
