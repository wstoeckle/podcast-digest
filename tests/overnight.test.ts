// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Digest, FeedResult } from '../src/types';
import {
  KEYS,
  addFeeds,
  clearFeeds,
  episodeId,
  overnightStatus,
  removeFeeds,
  runOvernight,
  type BatchDigestResult,
  type OvernightDeps,
  type OvernightStore,
} from '../api/_lib/overnight';
import { digestKey, transcriptKey } from '../api/_lib/transcripts';

/** In-memory stand-in for the Redis operations the pipeline uses. */
function memoryStore(): OvernightStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const setOf = (k: string) => {
    if (!data.has(k)) data.set(k, new Set<string>());
    return data.get(k) as Set<string>;
  };
  const hashOf = (k: string) => {
    if (!data.has(k)) data.set(k, {} as Record<string, unknown>);
    return data.get(k) as Record<string, unknown>;
  };
  const listOf = (k: string) => {
    if (!data.has(k)) data.set(k, [] as unknown[]);
    return data.get(k) as unknown[];
  };
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    data,
    async get<T>(k: string) {
      return data.has(k) ? clone(data.get(k) as T) : null;
    },
    async set(k, v, opts) {
      if (opts?.nx && data.has(k)) return false;
      data.set(k, clone(v));
      return true;
    },
    async del(k) {
      data.delete(k);
    },
    async exists(k) {
      return data.has(k);
    },
    async hset(k, values) {
      Object.assign(hashOf(k), clone(values));
    },
    async hdel(k, fields) {
      const h = hashOf(k);
      for (const f of fields) delete h[f];
    },
    async hgetall<T>(k: string) {
      return clone(hashOf(k)) as Record<string, T>;
    },
    async sadd(k, members) {
      for (const m of members) setOf(k).add(m);
    },
    async srem(k, members) {
      for (const m of members) setOf(k).delete(m);
    },
    async smembers(k) {
      return [...setOf(k)];
    },
    async lpush(k, v) {
      listOf(k).unshift(clone(v));
    },
    async ltrim(k, start, end) {
      data.set(k, listOf(k).slice(start, end + 1));
    },
    async lrange<T>(k: string, start: number, end: number) {
      return clone(listOf(k).slice(start, end + 1)) as T[];
    },
  };
}

const NOW = Date.parse('2026-11-18T09:00:00Z');
const HOUR = 3600_000;

function feed(title: string, episodes: FeedResult['episodes']): FeedResult {
  return { show: { id: title, title, feedUrl: `https://f.test/${title}` }, episodes };
}

const digest: Digest = {
  tldr: 'A TLDR.',
  bullets: ['A point.'],
  topics: ['t'],
  outline: [{ title: 'Start', summary: 's', start: 0 }],
  quotes: [{ text: 'the batteries got cheap' }],
};

function harness(feeds: Record<string, FeedResult>) {
  const store = memoryStore();
  const batches = new Map<string, { customId: string; transcript: string }[]>();
  const sttJobs = new Map<string, number>(); // jobId → polls until ready
  let finished = false;
  const deps: OvernightDeps = {
    store,
    now: () => NOW,
    sleep: async () => {},
    fetchFeed: async (url) => feeds[url] ?? null,
    fetchTranscript: async (url) =>
      url.includes('published') ? '[0:00] Host: the batteries got cheap.\n[0:40] More.' : null,
    stt: {
      submit: async (audioUrl) => {
        const id = `job-${audioUrl.split('/').pop()}`;
        sttJobs.set(id, 1);
        return id;
      },
      poll: async (jobId) => {
        const left = sttJobs.get(jobId) ?? 0;
        if (left > 0) {
          sttJobs.set(jobId, left - 1);
          return { status: 'processing' };
        }
        return { status: 'ready', text: '[0:00] Speaker A: transcribed words here.' };
      },
    },
    claude: {
      createBatch: async (items) => {
        const id = `batch-${batches.size + 1}`;
        batches.set(id, items);
        return id;
      },
      readBatch: async (id): Promise<BatchDigestResult[] | null> =>
        finished ? (batches.get(id) ?? []).map((i) => ({ customId: i.customId, digest })) : null,
    },
    log: () => {},
  };
  return { store, deps, batches, finish: () => (finished = true) };
}

const cfg = { maxEpisodes: 8, maxTranscribe: 4 };

describe('followed shows', () => {
  it('adds, keeps the original date, removes, clears, and caps', async () => {
    const store = memoryStore();
    await addFeeds(store, [{ feedUrl: 'https://a.test/rss', title: 'A' }], 1);
    await addFeeds(
      store,
      [
        { feedUrl: 'https://a.test/rss', title: 'A2' },
        { feedUrl: 'https://b.test/rss', title: 'B' },
      ],
      2,
    );
    const feeds = await store.hgetall<{ title: string; addedAt: number }>(KEYS.feeds);
    expect(feeds['https://a.test/rss']).toEqual({ title: 'A2', addedAt: 1 });
    await removeFeeds(store, ['https://a.test/rss']);
    expect(Object.keys(await store.hgetall(KEYS.feeds))).toEqual(['https://b.test/rss']);
    await clearFeeds(store);
    expect(await store.hgetall(KEYS.feeds)).toEqual({});

    const many = Array.from({ length: 250 }, (_, i) => ({
      feedUrl: `https://f.test/${i}`,
      title: `${i}`,
    }));
    await addFeeds(store, many, 3);
    expect(Object.keys(await store.hgetall(KEYS.feeds))).toHaveLength(200);
  });
});

describe('runOvernight', () => {
  const recent = new Date(NOW - 5 * HOUR).toISOString();
  const old = new Date(NOW - 10 * 24 * HOUR).toISOString();

  it('digests new episodes overnight and has them ready when the app opens', async () => {
    const h = harness({
      'https://f.test/A': feed('A', [
        {
          guid: 'a1',
          title: 'A new',
          publishedAt: recent,
          transcriptUrl: 'https://t.test/published.vtt',
        },
        {
          guid: 'a0',
          title: 'A old',
          publishedAt: old,
          transcriptUrl: 'https://t.test/published.vtt',
        },
      ]),
      'https://f.test/B': feed('B', [
        { guid: 'b1', title: 'B new', publishedAt: recent, audioUrl: 'https://cdn.test/b1.mp3' },
      ]),
    });
    await addFeeds(
      h.store,
      [
        { feedUrl: 'https://f.test/A', title: 'A' },
        { feedUrl: 'https://f.test/B', title: 'B' },
      ],
      0,
    );

    const night = await runOvernight(h.deps, cfg, 'nightly');
    // a1 had a published transcript; b1 was transcribed while the run waited.
    expect(night).toMatchObject({ discovered: 2, transcribing: 1, batched: 2, collected: 0 });
    expect(await h.store.get(transcriptKey('b1'))).toContain('[0:00] Speaker A:');
    expect([...h.batches.values()][0]?.map((i) => i.customId).sort()).toEqual(
      [episodeId('a1'), episodeId('b1')].sort(),
    );
    expect((await overnightStatus(h.store, { scheduled: true, now: NOW })).pending).toBe(2);

    // Morning: the batch has finished; opening the app collects it.
    h.finish();
    const morning = await runOvernight(h.deps, cfg, 'collect');
    expect(morning.collected).toBe(2);
    const cached = await h.store.get<Digest>(digestKey('a1'));
    expect(cached?.tldr).toBe('A TLDR.');
    // Grounded against the transcript: the quote gets its time.
    expect(cached?.quotes).toEqual([{ text: 'the batteries got cheap', start: 0 }]);

    const status = await overnightStatus(h.store, { scheduled: true, now: NOW });
    expect(status).toMatchObject({ available: true, following: 2, pending: 0 });
    // The picked shows come back, A–Z, so the picker can show them.
    expect(status.shows).toEqual([
      { feedUrl: 'https://f.test/A', title: 'A' },
      { feedUrl: 'https://f.test/B', title: 'B' },
    ]);
    expect(status.items.map((i) => i.guid).sort()).toEqual(['a1', 'b1']);
    expect(status.items[0]).toMatchObject({
      tldr: 'A TLDR.',
      feedUrl: expect.stringContaining('https://f.test/'),
    });
  });

  it('does not redo episodes on the next night', async () => {
    const h = harness({
      'https://f.test/A': feed('A', [
        {
          guid: 'a1',
          title: 'A new',
          publishedAt: recent,
          transcriptUrl: 'https://t.test/published.vtt',
        },
      ]),
    });
    await addFeeds(h.store, [{ feedUrl: 'https://f.test/A', title: 'A' }], 0);
    await runOvernight(h.deps, cfg, 'nightly');
    h.finish();
    await runOvernight(h.deps, cfg, 'collect');
    const again = await runOvernight(h.deps, cfg, 'nightly');
    expect(again.discovered).toBe(0);
    expect(h.batches.size).toBe(1);
  });

  it('respects the per-night caps and skips episodes it cannot transcribe', async () => {
    const eps = Array.from({ length: 6 }, (_, i) => ({
      guid: `s${i}`,
      title: `S${i}`,
      publishedAt: new Date(NOW - (i + 1) * HOUR).toISOString(),
      audioUrl: `https://cdn.test/s${i}.mp3`,
    }));
    const feeds: Record<string, FeedResult> = {};
    for (let i = 0; i < 6; i++) feeds[`https://f.test/S${i}`] = feed(`S${i}`, [eps[i]!]);
    const h = harness(feeds);
    await addFeeds(
      h.store,
      Object.keys(feeds).map((u) => ({ feedUrl: u, title: u })),
      0,
    );
    const r = await runOvernight(h.deps, { maxEpisodes: 8, maxTranscribe: 2 }, 'nightly');
    expect(r.transcribing).toBe(2);
    expect(r.discovered).toBe(2);
  });

  it('only one run at a time', async () => {
    const h = harness({});
    await h.store.set(KEYS.lock, 1);
    expect((await runOvernight(h.deps, cfg, 'collect')).skipped).toBeDefined();
  });

  it('collect mode never looks for new episodes', async () => {
    const h = harness({
      'https://f.test/A': feed('A', [
        {
          guid: 'a1',
          title: 'A new',
          publishedAt: recent,
          transcriptUrl: 'https://t.test/published.vtt',
        },
      ]),
    });
    await addFeeds(h.store, [{ feedUrl: 'https://f.test/A', title: 'A' }], 0);
    expect((await runOvernight(h.deps, cfg, 'collect')).discovered).toBe(0);
    expect(h.batches.size).toBe(0);
  });
});
