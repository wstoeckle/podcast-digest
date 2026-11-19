// findExistingTranscript against a fake web: the feed's transcript files come
// first, then the episode's own page, a linked transcript page on the same
// site, or NPR's transcript address. No network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findExistingTranscript } from '../api/_lib/transcripts';

let pages: Record<string, { body: string; type?: string; status?: number }>;
let fetched: string[];

beforeEach(() => {
  pages = {};
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const page = pages[url];
      if (!page) return new Response('not found', { status: 404 });
      return new Response(page.body, {
        status: page.status ?? 200,
        headers: { 'content-type': page.type ?? 'text/html; charset=utf-8' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A conversation long enough for a 10-minute episode, as transcript sites print it. */
function conversation(timed: boolean): string {
  return Array.from({ length: 60 }, (_, i) => {
    const who = i % 2 ? 'Guest' : 'Host';
    const t = `(00:${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')})`;
    return `<p>${who}${timed ? ` ${t}` : ':'} Line ${i} is a sentence of about twenty words, the way people really talk on a long podcast.</p>`;
  }).join('\n');
}

const NOTES = '<h1>Episode</h1><p>Show notes and sponsors.</p>';

describe('findExistingTranscript', () => {
  it("prefers the feed's transcript files, best first, skipping ones that fail", async () => {
    pages['https://cdn.test/t.vtt'] = {
      body: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello and welcome.\n\n00:00:40.000 --> 00:00:41.000\nThanks for listening.',
      type: 'text/vtt',
    };
    const found = await findExistingTranscript({
      transcripts: [
        { url: 'https://cdn.test/missing.json', type: 'application/json' },
        { url: 'https://cdn.test/t.vtt', type: 'text/vtt' },
      ],
      link: 'https://show.test/ep-1',
    });
    expect(found).toEqual({
      text: '[0:01] Hello and welcome.\n[0:40] Thanks for listening.',
      source: 'rss',
    });
    expect(fetched).not.toContain('https://show.test/ep-1');
  });

  it("finds a transcript on the episode's own page", async () => {
    pages['https://show.test/ep-1'] = {
      body: `<main>${NOTES}<h2>Transcript</h2>${conversation(false)}</main>`,
    };
    const found = await findExistingTranscript({
      link: 'https://show.test/ep-1',
      durationSec: 600,
    });
    expect(found?.source).toBe('web');
    expect(found?.text.startsWith('Host: Line 0')).toBe(true);
    expect(found?.text).not.toContain('sponsors');
  });

  it('follows a link to the transcript page and keeps its timestamps', async () => {
    pages['https://show.test/larry-lawton'] = {
      body: `${NOTES}<a href="/larry-lawton-transcript">Transcript</a>
        <a href="https://other.test/larry-lawton-transcript">Transcript</a>`,
    };
    pages['https://show.test/larry-lawton-transcript'] = {
      body: `<article>${conversation(true)}</article>`,
    };
    const found = await findExistingTranscript({
      link: 'https://show.test/larry-lawton',
      durationSec: 600,
    });
    expect(found?.source).toBe('web');
    expect(found?.text.split('\n')[0]).toMatch(/^\[0:00\] Host: Line 0/);
    expect(fetched).not.toContain('https://other.test/larry-lawton-transcript');
  });

  it("goes straight to NPR's transcript page", async () => {
    pages['https://www.npr.org/transcripts/nx-s1-5327301'] = {
      body: `<div>Transcript</div><h1>Batteries</h1><p>Transcript</p>${conversation(false)}`,
    };
    const found = await findExistingTranscript({
      link: 'https://www.npr.org/2025/03/14/nx-s1-5327301/batteries',
      durationSec: 600,
    });
    expect(found?.source).toBe('web');
    expect(fetched).toEqual(['https://www.npr.org/transcripts/nx-s1-5327301']);
  });

  it('returns null for show notes, private hosts, and dead links', async () => {
    pages['https://show.test/ep-2'] = { body: `<main>${NOTES}</main>` };
    expect(
      await findExistingTranscript({ link: 'https://show.test/ep-2', durationSec: 3600 }),
    ).toBeNull();
    expect(await findExistingTranscript({ link: 'http://localhost/ep' })).toBeNull();
    expect(await findExistingTranscript({ link: 'https://show.test/gone' })).toBeNull();
    expect(await findExistingTranscript({})).toBeNull();
    expect(fetched).not.toContain('http://localhost/ep');
  });

  it('does not read files that are not web pages', async () => {
    pages['https://show.test/ep.mp3'] = { body: conversation(false), type: 'audio/mpeg' };
    expect(await findExistingTranscript({ link: 'https://show.test/ep.mp3' })).toBeNull();
  });
});
