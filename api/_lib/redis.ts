// Lazy Upstash Redis client. Returns null when the env vars are missing so
// handlers degrade to "no cache" instead of crashing (mirrors geo-game).

import { Redis } from '@upstash/redis';

let cached: Redis | null | undefined;

export function redis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

/** 30 days — transcripts and digests are effectively immutable per episode. */
export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
