// Per-IP rate limiting for the expensive endpoints, backed by the same Upstash
// Redis used for caching. Protects your Anthropic + AssemblyAI keys from anyone
// who finds the public URL. Fails OPEN when Redis isn't configured (so demo mode
// and local dev still work) — with Upstash set, the caps are enforced.

import { Ratelimit } from '@upstash/ratelimit';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from './redis.js';

function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const ip = raw?.split(',')[0]?.trim();
  return ip || (req.headers['x-real-ip'] as string | undefined) || 'unknown';
}

// Cache limiter instances by name+limit so we reuse one per config.
const limiters = new Map<string, Ratelimit>();

function limiter(name: string, perHour: number): Ratelimit | null {
  const kv = redis();
  if (!kv) return null;
  const key = `${name}:${perHour}`;
  let rl = limiters.get(key);
  if (!rl) {
    rl = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(perHour, '1 h'),
      prefix: `rl:${name}`,
      analytics: false,
    });
    limiters.set(key, rl);
  }
  return rl;
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  /** Unix ms when the window resets. */
  reset: number;
  limit: number;
}

/**
 * Rate-limit an expensive action. Two ceilings, both metered just before the
 * costly work (so cheap cache hits never count):
 *   - per client IP, and
 *   - a GLOBAL all-callers cap, so many IPs can't multiply the per-IP budget
 *     into a big bill. This is the "the deployment can never spend more than
 *     X/hour, period" backstop.
 * Returns null when Redis isn't configured (not enforced).
 */
export async function rateLimit(
  req: VercelRequest,
  opts: { name: string; perHour: number; globalPerHour?: number },
): Promise<RateResult | null> {
  const rl = limiter(opts.name, opts.perHour);
  if (!rl) return null;
  const perIp = await rl.limit(clientIp(req));
  if (!perIp.success) {
    return { ok: false, remaining: perIp.remaining, reset: perIp.reset, limit: perIp.limit };
  }
  if (opts.globalPerHour) {
    const grl = limiter(`${opts.name}-global`, opts.globalPerHour);
    if (grl) {
      const g = await grl.limit('all');
      if (!g.success) return { ok: false, remaining: g.remaining, reset: g.reset, limit: g.limit };
    }
  }
  return { ok: true, remaining: perIp.remaining, reset: perIp.reset, limit: perIp.limit };
}

function intEnv(name: string, dflt: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Per-IP hourly caps (env-overridable). */
export const llmPerHour = (): number => intEnv('RL_LLM_PER_HOUR', 40);
export const sttPerHour = (): number => intEnv('RL_STT_PER_HOUR', 15);

/** Whole-deployment hourly ceilings across ALL callers (env-overridable). */
export const llmGlobalPerHour = (): number => intEnv('RL_LLM_GLOBAL_PER_HOUR', 150);
export const sttGlobalPerHour = (): number => intEnv('RL_STT_GLOBAL_PER_HOUR', 30);

/** Send a 429 with a Retry-After header derived from the reset time. */
export function tooMany(res: VercelResponse, rl: RateResult): void {
  const seconds = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    error: `Rate limit reached (${rl.limit}/hour). Try again in ~${Math.ceil(seconds / 60)} min.`,
  });
}
