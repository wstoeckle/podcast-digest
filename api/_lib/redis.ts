// Lazy Upstash Redis client. Redis only makes the app cheaper and safer
// (caching, rate limits, overnight digests), so it must never take the app
// down: redis() returns null when it isn't configured, and also for a minute
// after a call fails to reach it. Handlers already treat null as "no cache".

import { Redis } from '@upstash/redis';

/** How long Redis counts as off after a call fails, before the next try. */
const DOWN_MS = 60_000;

let cached: Redis | null | undefined;
let downUntil = 0;

export function redis(): Redis | null {
  if (Date.now() < downUntil) return null;
  if (cached !== undefined) return cached;
  // Upstash's own names, or the KV_* names Vercel's Storage tab sets when it
  // creates an Upstash database for the project.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  // Two quick retries (~0.2s) ride out a blip; the default five take ~4s per
  // call when Redis is really gone.
  cached = new Redis({ url, token, retry: { retries: 2 } });
  return cached;
}

/** True while Redis counts as off after a failed call (it is configured, just unreachable). */
export function isRedisDown(): boolean {
  return Date.now() < downUntil;
}

/** Note that Redis couldn't be reached, and treat it as off for a minute. */
export function markRedisDown(op: string, err: unknown): void {
  downUntil = Date.now() + DOWN_MS;
  console.error(
    JSON.stringify({
      event: 'redis_unavailable',
      op,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Run a Redis call, or return `fallback` when Redis is off or the call fails.
 * A failure marks Redis down, so the rest of the request (and the next minute
 * of requests) skip it instead of each waiting on it.
 */
export async function tryRedis<T>(
  op: string,
  fn: (kv: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  const kv = redis();
  if (!kv) return fallback;
  try {
    return await fn(kv);
  } catch (err) {
    markRedisDown(op, err);
    return fallback;
  }
}

/** 30 days — transcripts and digests are effectively immutable per episode. */
export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
