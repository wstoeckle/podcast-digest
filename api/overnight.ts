// /api/overnight — overnight digests of new episodes from followed shows.
//   GET                  status + the latest overnight digests; also collects
//                        finished work (at most once a minute)
//   GET (from Vercel Cron, with `Authorization: Bearer $CRON_SECRET`)
//                        the nightly run
//   POST { action }      keep the server's copy of your followed shows in step:
//                        add { shows }, remove { feedUrls }, or clear
// Opt-in from the home page; needs Upstash Redis and ANTHROPIC_API_KEY.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Redis } from '@upstash/redis';
import type { FeedResult, OvernightStatus } from '../src/types.js';
import { parseFeed } from '../src/lib/rss.js';
import { createDigestBatch, hasClaude, readDigestBatch } from './_lib/anthropic.js';
import { fetchWithTimeout, jsonBody, methodNotAllowed, safeRemoteUrl, str } from './_lib/http.js';
import {
  addFeeds,
  clearFeeds,
  overnightStatus,
  removeFeeds,
  runOvernight,
  type OvernightConfig,
  type OvernightDeps,
  type OvernightStore,
} from './_lib/overnight.js';
import { rateLimit, tooMany } from './_lib/ratelimit.js';
import { redis } from './_lib/redis.js';
import { sttProvider } from './_lib/stt.js';
import { fetchTranscriptFile } from './_lib/transcripts.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const kv = redis();

  if (req.method === 'GET' && isCron(req)) return void (await nightly(res, kv));

  if (!kv || !hasClaude()) {
    res.status(200).json({
      available: false,
      reason: !kv
        ? 'Overnight digests need Upstash Redis set up on the server.'
        : 'Overnight digests need an ANTHROPIC_API_KEY on the server.',
      scheduled: false,
      following: 0,
      shows: [],
      pending: 0,
      items: [],
    } satisfies OvernightStatus);
    return;
  }
  const store = redisStore(kv);

  if (req.method === 'GET') {
    // Pick up finished batches and transcriptions, at most once a minute.
    if (await store.set('ov:collect', 1, { nx: true, ex: 60 })) {
      try {
        const summary = await runOvernight(deps(store), config(), 'collect');
        if (summary.collected || summary.batched) {
          console.log(JSON.stringify({ event: 'overnight_collect', ...summary }));
        }
      } catch (err) {
        console.error(
          JSON.stringify({ event: 'overnight_collect_error', error: (err as Error).message }),
        );
      }
    }
    res.status(200).json(await status(store));
    return;
  }

  if (req.method === 'POST') {
    const rl = await rateLimit(req, { name: 'overnight', perHour: 120, globalPerHour: 600 });
    if (rl && !rl.ok) return tooMany(res, rl);
    const body = jsonBody(req);
    const action = str(body.action);
    if (action === 'add') {
      await addFeeds(store, parseShows(body.shows), Date.now());
    } else if (action === 'remove') {
      await removeFeeds(store, parseUrls(body.feedUrls));
    } else if (action === 'clear') {
      await clearFeeds(store);
    } else {
      res.status(400).json({ error: 'action must be add, remove, or clear' });
      return;
    }
    res.status(200).json(await status(store));
    return;
  }

  methodNotAllowed(res, 'GET, POST');
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set. */
function isCron(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

/** The nightly run. */
async function nightly(res: VercelResponse, kv: Redis | null) {
  if (!kv || !hasClaude()) {
    res.status(200).json({ skipped: 'Redis or ANTHROPIC_API_KEY not configured' });
    return;
  }
  const summary = await runOvernight(deps(redisStore(kv)), config(), 'nightly');
  console.log(JSON.stringify({ event: 'overnight_run', ...summary }));
  res.status(200).json(summary);
}

function status(store: OvernightStore): Promise<OvernightStatus> {
  return overnightStatus(store, { scheduled: Boolean(process.env.CRON_SECRET), now: Date.now() });
}

function config(): OvernightConfig {
  return {
    maxEpisodes: intEnv('OVERNIGHT_MAX_EPISODES', 8),
    maxTranscribe: intEnv('OVERNIGHT_MAX_TRANSCRIBE', 4),
  };
}

function intEnv(name: string, dflt: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function deps(store: OvernightStore): OvernightDeps {
  return {
    store,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchFeed,
    fetchTranscript: (url, type) => {
      const safe = safeRemoteUrl(url);
      return safe ? fetchTranscriptFile(safe.toString(), type) : Promise.resolve(null);
    },
    stt: sttProvider(),
    claude: { createBatch: createDigestBatch, readBatch: readDigestBatch },
    log: (event) => console.log(JSON.stringify(event)),
  };
}

async function fetchFeed(url: string): Promise<FeedResult | null> {
  const safe = safeRemoteUrl(url);
  if (!safe) return null;
  const r = await fetchWithTimeout(safe.toString(), 15000);
  if (!r.ok) return null;
  return parseFeed(await r.text(), safe.toString());
}

function parseShows(v: unknown): { feedUrl: string; title: string; artwork?: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { feedUrl: string; title: string; artwork?: string }[] = [];
  for (const item of v.slice(0, 300)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const feedUrl = safeRemoteUrl(str(rec.feedUrl))?.toString();
    const title = str(rec.title)?.slice(0, 300);
    if (!feedUrl || !title) continue;
    const artwork = safeRemoteUrl(str(rec.artwork))?.toString();
    out.push(artwork ? { feedUrl, title, artwork } : { feedUrl, title });
  }
  return out;
}

function parseUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 300)
    .map((u) => safeRemoteUrl(typeof u === 'string' ? u : undefined)?.toString())
    .filter((u): u is string => Boolean(u));
}

/** The pipeline's store over Upstash Redis (values are JSON-encoded by the client). */
function redisStore(kv: Redis): OvernightStore {
  return {
    get: (key) => kv.get(key),
    async set(key, value, opts) {
      const r = opts?.nx
        ? await kv.set(key, value, opts.ex ? { nx: true, ex: opts.ex } : { nx: true })
        : await kv.set(key, value, opts?.ex ? { ex: opts.ex } : undefined);
      return r !== null;
    },
    async del(key) {
      await kv.del(key);
    },
    async exists(key) {
      return (await kv.exists(key)) > 0;
    },
    async hset(key, values) {
      await kv.hset(key, values);
    },
    async hdel(key, fields) {
      if (fields.length) await kv.hdel(key, ...fields);
    },
    async hgetall<T>(key: string) {
      return ((await kv.hgetall(key)) ?? {}) as Record<string, T>;
    },
    async sadd(key, members) {
      const [first, ...rest] = members;
      if (first !== undefined) await kv.sadd(key, first, ...rest);
    },
    async srem(key, members) {
      if (members.length) await kv.srem(key, ...members);
    },
    smembers: (key) => kv.smembers(key),
    async lpush(key, value) {
      await kv.lpush(key, value);
    },
    async ltrim(key, start, end) {
      await kv.ltrim(key, start, end);
    },
    lrange: (key, start, end) => kv.lrange(key, start, end),
  };
}
