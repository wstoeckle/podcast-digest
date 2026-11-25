// Sharing the app: friends bring their own keys, and the app's own keys are
// only spent for its owner. The endpoints run against an in-memory Redis and
// fake Claude / AssemblyAI clients that record which key they were given.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

vi.mock('../api/_lib/redis', () => ({
  CACHE_TTL_SECONDS: 60,
  redis: () => null,
  isRedisDown: () => false,
  markRedisDown: () => {},
  tryRedis: async <T>(_op: string, fn: (kv: unknown) => Promise<T>) =>
    fn({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: unknown) => {
        store.set(k, v);
        return 'OK';
      },
    }),
}));

const claude = vi.hoisted(() => ({
  generateDigest: vi.fn(async (transcript: string, _meta: unknown, key: string | undefined) =>
    key
      ? { tldr: `digest of ${transcript.slice(0, 12)} by ${key}`, bullets: [], topics: [] }
      : { tldr: 'sample', bullets: [], topics: [], demo: true },
  ),
  checkClaudeKey: vi.fn(async (key: string) => (key === 'sk-good' ? 'ok' : 'rejected')),
}));

vi.mock('../api/_lib/anthropic', () => ({
  generateDigest: claude.generateDigest,
  checkClaudeKey: claude.checkClaudeKey,
  isKeyRejected: (err: unknown) => (err as { status?: number })?.status === 401,
  streamAnswer: vi.fn(),
  hasClaude: () => Boolean(process.env.ANTHROPIC_API_KEY),
  createDigestBatch: vi.fn(),
  readDigestBatch: vi.fn(),
}));

const stt = vi.hoisted(() => ({
  submitted: [] as { key: string; audio: string }[],
}));

vi.mock('../api/_lib/stt', () => ({
  sttProvider: (key = process.env.ASSEMBLYAI_API_KEY) =>
    key
      ? {
          submit: async (audio: string) => {
            stt.submitted.push({ key, audio });
            return `job-${key}`;
          },
          poll: async () => ({ status: 'processing' }),
        }
      : null,
  isSttKeyRejected: () => false,
  checkSttKey: async () => 'ok',
}));

const { default: digest } = await import('../api/digest');
const { default: transcript } = await import('../api/transcript');
const { default: overnight } = await import('../api/overnight');
const { default: accessRoute } = await import('../api/access');
const { digestKey, transcriptKey } = await import('../api/_lib/transcripts');

function call(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; query?: object },
) {
  const out = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  const req = {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? {},
    body: opts.body ?? {},
    query: opts.query ?? {},
  };
  return Promise.resolve(
    handler(req as unknown as VercelRequest, res as unknown as VercelResponse),
  ).then(() => out);
}

const OWNER = { 'x-owner-code': 'open-sesame' };
const TRANSCRIPT = '[0:00] Host: the shared transcript of the episode.';

beforeEach(() => {
  store.clear();
  stt.submitted.length = 0;
  claude.generateDigest.mockClear();
  vi.stubEnv('OWNER_CODE', 'open-sesame');
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-owner');
  vi.stubEnv('ASSEMBLYAI_API_KEY', 'aai-owner');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/digest', () => {
  it("asks a visitor without a key for one, and never spends the owner's", async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    const r = await call(digest, { body: { guid: 'ep1' } });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'needs_key' });
    expect(claude.generateDigest).not.toHaveBeenCalled();
  });

  it('gives anyone a digest that was already made, for free', async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    store.set(digestKey('ep1'), { tldr: 'made earlier', bullets: [], topics: [] });
    const r = await call(digest, { body: { guid: 'ep1', transcript: TRANSCRIPT } });
    expect(r.body).toMatchObject({ tldr: 'made earlier' });
    expect(claude.generateDigest).not.toHaveBeenCalled();
  });

  it("spends a friend's own key, and shares the digest", async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    const r = await call(digest, {
      headers: { 'x-anthropic-key': 'sk-friend' },
      body: { guid: 'ep1', transcript: TRANSCRIPT },
    });
    expect(r.status).toBe(200);
    expect(claude.generateDigest.mock.calls[0]?.[2]).toBe('sk-friend');
    expect(store.get(digestKey('ep1'))).toMatchObject({
      tldr: expect.stringContaining('sk-friend'),
    });
  });

  it("spends the app's key for the owner", async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    await call(digest, { headers: OWNER, body: { guid: 'ep1' } });
    expect(claude.generateDigest.mock.calls[0]?.[2]).toBe('sk-owner');
  });

  it('keeps a digest of a different (pasted) transcript out of the shared cache', async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    store.set(digestKey('ep1'), { tldr: 'shared digest', bullets: [], topics: [] });
    const r = await call(digest, {
      headers: { 'x-anthropic-key': 'sk-friend' },
      body: { guid: 'ep1', transcript: 'Something else entirely, pasted by a visitor.' },
    });
    // Not the cached digest of the shared transcript...
    expect(r.body).toMatchObject({ tldr: expect.stringContaining('Something el') });
    // ...and the shared one is untouched.
    expect(store.get(digestKey('ep1'))).toMatchObject({ tldr: 'shared digest' });
  });

  it("points to Settings when Anthropic refuses the caller's key", async () => {
    store.set(transcriptKey('ep1'), TRANSCRIPT);
    claude.generateDigest.mockRejectedValueOnce(Object.assign(new Error('401'), { status: 401 }));
    const r = await call(digest, {
      headers: { 'x-anthropic-key': 'sk-bad' },
      body: { guid: 'ep1' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'key_rejected' });
  });
});

describe('POST /api/transcript', () => {
  it('returns a pasted transcript without caching it for everyone', async () => {
    const r = await call(transcript, {
      body: { guid: 'ep2', transcript: 'Host: a pasted transcript that is long enough to count.' },
    });
    expect(r.body).toMatchObject({ status: 'ready', source: 'pasted' });
    expect(store.has(transcriptKey('ep2'))).toBe(false);
  });

  it("asks a visitor for an AssemblyAI key before transcribing on the owner's", async () => {
    const r = await call(transcript, {
      body: { guid: 'ep3', audioUrl: 'https://cdn.test/ep3.mp3' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ status: 'error', code: 'needs_key' });
    expect(stt.submitted).toEqual([]);
  });

  it("transcribes on a friend's own key, or the owner's for the owner", async () => {
    await call(transcript, {
      headers: { 'x-assemblyai-key': 'aai-friend' },
      body: { guid: 'ep3', audioUrl: 'https://cdn.test/ep3.mp3' },
    });
    await call(transcript, {
      headers: OWNER,
      body: { guid: 'ep4', audioUrl: 'https://cdn.test/ep4.mp3' },
    });
    expect(stt.submitted.map((s) => s.key)).toEqual(['aai-friend', 'aai-owner']);
  });
});

describe('overnight digests', () => {
  it('are only for the owner', async () => {
    const status = await call(overnight, { method: 'GET' });
    expect(status.body).toMatchObject({ available: false, reason: expect.stringMatching(/owner/) });
    const post = await call(overnight, { body: { action: 'clear' } });
    expect(post.status).toBe(403);
  });
});

describe('GET /api/access', () => {
  it('tells the device whose keys it uses, and checks its own on request', async () => {
    expect((await call(accessRoute, { method: 'GET' })).body).toEqual({
      owner: false,
      ownerCode: true,
      claude: 'locked',
      stt: 'locked',
    });
    expect((await call(accessRoute, { method: 'GET', headers: OWNER })).body).toMatchObject({
      owner: true,
      claude: 'server',
    });
    const checked = await call(accessRoute, {
      method: 'GET',
      headers: { 'x-anthropic-key': 'sk-good' },
      query: { check: '1' },
    });
    expect(checked.body).toMatchObject({ claude: 'caller', claudeKey: 'ok' });
    expect(JSON.stringify(checked.body)).not.toContain('sk-good');
  });
});
