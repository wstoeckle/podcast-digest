import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Redis helper remembers its client and whether Redis is down, so each
// case loads fresh copies of the modules.
async function load() {
  vi.resetModules();
  return import('../api/_lib/redis');
}

const ENV = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
];

function clearEnv() {
  for (const k of ENV) vi.stubEnv(k, '');
}

function configure() {
  clearEnv();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://gone.upstash.test');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('redis', () => {
  it('is off without settings', async () => {
    clearEnv();
    expect((await load()).redis()).toBeNull();
  });

  it("takes Upstash's own variable names", async () => {
    configure();
    expect((await load()).redis()).not.toBeNull();
  });

  it('takes the KV_* names Vercel Storage sets', async () => {
    clearEnv();
    vi.stubEnv('KV_REST_API_URL', 'https://b.upstash.test');
    vi.stubEnv('KV_REST_API_TOKEN', 't');
    expect((await load()).redis()).not.toBeNull();
  });
});

describe('tryRedis', () => {
  it('skips the call when Redis is off', async () => {
    clearEnv();
    const fn = vi.fn(async () => 'value');
    expect(await (await load()).tryRedis('op', fn, 'fallback')).toBe('fallback');
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the call's result when Redis answers", async () => {
    configure();
    expect(await (await load()).tryRedis('op', async () => 'value', 'fallback')).toBe('value');
  });

  it('falls back when a call fails, and leaves Redis alone for a minute', async () => {
    configure();
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });
    const r = await load();

    const failing = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND gone.upstash.test');
    });
    expect(await r.tryRedis('feed_get', failing, null)).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"redis_unavailable"'));

    // Down: no client, and no further calls for the next minute.
    expect(r.isRedisDown()).toBe(true);
    expect(r.redis()).toBeNull();
    const next = vi.fn(async () => 'value');
    expect(await r.tryRedis('feed_get', next, 'fallback')).toBe('fallback');
    expect(next).not.toHaveBeenCalled();

    // A minute later it tries again.
    vi.setSystemTime(61_000);
    expect(r.isRedisDown()).toBe(false);
    expect(await r.tryRedis('feed_get', next, 'fallback')).toBe('value');
  });
});

/** A minimal Vercel response that records what the handler sent. */
function fakeRes() {
  const out = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      out.statusCode = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k] = v;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, out };
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Show</title>
  <item><guid>ep-1</guid><title>Episode 1</title>
  <enclosure url="https://cdn.test/1.mp3" type="audio/mpeg"/></item></channel></rss>`;

describe('with Redis configured but unreachable', () => {
  // The real failure: the database is gone, so every request to it fails.
  beforeEach(() => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('upstash.test')) throw new TypeError('fetch failed');
        if (url === 'https://feeds.test/show.xml') return new Response(RSS);
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('still serves a feed, without the cache', async () => {
    await load();
    const feed = (await import('../api/feed')).default;
    const { res, out } = fakeRes();
    await feed(
      { method: 'GET', query: { url: 'https://feeds.test/show.xml' } } as unknown as VercelRequest,
      res,
    );
    expect(out.statusCode).toBe(200);
    expect(out.body).toMatchObject({ show: { title: 'Show' }, episodes: [{ guid: 'ep-1' }] });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"op":"feed_get"'));
  });

  it('lets requests through instead of rate limiting them', async () => {
    await load();
    const { rateLimit } = await import('../api/_lib/ratelimit');
    const req = { headers: { 'x-forwarded-for': '1.2.3.4' } } as unknown as VercelRequest;
    expect(await rateLimit(req, { name: 'llm', perHour: 1, globalPerHour: 1 })).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"op":"ratelimit_llm"'));
  });
});
