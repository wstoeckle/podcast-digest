import { afterEach, describe, expect, it, vi } from 'vitest';

// redis() remembers its client, so each case loads a fresh copy of the module.
async function load() {
  vi.resetModules();
  return (await import('../api/_lib/redis')).redis;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('redis', () => {
  function clear() {
    for (const k of [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
    ]) {
      vi.stubEnv(k, '');
    }
  }

  it('is off without settings', async () => {
    clear();
    expect((await load())()).toBeNull();
  });

  it("takes Upstash's own variable names", async () => {
    clear();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://a.upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't');
    expect((await load())()).not.toBeNull();
  });

  it('takes the KV_* names Vercel Storage sets', async () => {
    clear();
    vi.stubEnv('KV_REST_API_URL', 'https://b.upstash.test');
    vi.stubEnv('KV_REST_API_TOKEN', 't');
    expect((await load())()).not.toBeNull();
  });
});
