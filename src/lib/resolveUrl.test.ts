import { describe, it, expect } from 'vitest';
import { classifyLink, looksLikeAudio, pickFromShareHtml } from './resolveUrl';

describe('classifyLink', () => {
  it('recognizes an Apple Podcasts show + episode link', () => {
    const r = classifyLink(
      'https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000654321000',
    );
    expect(r.kind).toBe('apple');
    expect(r.appleCollectionId).toBe('1200361736');
    expect(r.appleEpisodeId).toBe('1000654321000');
  });

  it('recognizes an Apple show link without an episode', () => {
    const r = classifyLink('https://podcasts.apple.com/us/podcast/foo/id42');
    expect(r.kind).toBe('apple');
    expect(r.appleCollectionId).toBe('42');
    expect(r.appleEpisodeId).toBeUndefined();
  });

  it('recognizes a Pocket Casts share link', () => {
    const r = classifyLink('https://pca.st/episode/abc123');
    expect(r.kind).toBe('pocketcasts');
    expect(r.pocketCastsUrl).toBe('https://pca.st/episode/abc123');
  });

  it('recognizes a direct audio URL', () => {
    const r = classifyLink('https://cdn.example.com/media/ep1.mp3?token=x');
    expect(r.kind).toBe('audio');
    expect(r.audioUrl).toContain('ep1.mp3');
  });

  it('recognizes Spotify episode, show, and short links', () => {
    const ep = classifyLink('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=abc123');
    expect(ep.kind).toBe('spotify');
    expect(ep.spotifyUrl).toContain('/episode/4rOoJ6Egrf8K2IrywzwOMk');

    const show = classifyLink('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk');
    expect(show.kind).toBe('spotify');

    const short = classifyLink('https://spotify.link/AbCdEf123');
    expect(short.kind).toBe('spotify');
    expect(short.spotifyUrl).toBe('https://spotify.link/AbCdEf123');
  });

  it('treats other URLs as feeds', () => {
    const r = classifyLink('https://feeds.example.com/show/rss');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://feeds.example.com/show/rss');
  });

  it('adds a scheme when the user omits one', () => {
    const r = classifyLink('feeds.example.com/rss.xml');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://feeds.example.com/rss.xml');
  });

  it('returns unknown for nonsense (spaces cannot be a host)', () => {
    expect(classifyLink('just some words here').kind).toBe('unknown');
  });
});

describe('looksLikeAudio', () => {
  it('matches common audio extensions', () => {
    expect(looksLikeAudio('https://x/y.m4a')).toBe(true);
    expect(looksLikeAudio('https://x/y.opus?a=1')).toBe(true);
    expect(looksLikeAudio('https://x/y.html')).toBe(false);
  });
});

describe('pickFromShareHtml', () => {
  it('prefers a declared RSS feed link tag', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="https://feeds.example.com/show?u=1&amp;t=2"></head>`;
    expect(pickFromShareHtml(html)).toEqual({
      kind: 'feed',
      url: 'https://feeds.example.com/show?u=1&t=2',
    });
  });

  it('finds an og:audio URL (the Pocket Casts case)', () => {
    const mp3 = 'https://dts.podtrac.com/redirect.mp3/host/audio.mp3?v=abc';
    const html = `<meta property="og:audio" content="${mp3}"><a href="https://pocketcasts.com/podcast/x">x</a>`;
    expect(pickFromShareHtml(html)).toEqual({ kind: 'audio', url: mp3 });
  });

  it('falls back to an Apple Podcasts link', () => {
    const html = `<a href="https://podcasts.apple.com/us/podcast/x/id123?i=456">Apple</a>`;
    expect(pickFromShareHtml(html)).toEqual({
      kind: 'apple',
      url: 'https://podcasts.apple.com/us/podcast/x/id123?i=456',
    });
  });

  it('finds a bare audio URL in the body', () => {
    const html = `<audio src="https://cdn.example.com/ep1.mp3?t=9"></audio>`;
    expect(pickFromShareHtml(html)).toEqual({
      kind: 'audio',
      url: 'https://cdn.example.com/ep1.mp3?t=9',
    });
  });

  it('does not misread an Apple URL as an RSS feed', () => {
    const html = `<a href="https://podcasts.apple.com/us/podcast/x/id1/feed">x</a>`;
    expect(pickFromShareHtml(html).kind).toBe('apple');
  });

  it('returns none when nothing resolvable is present', () => {
    expect(pickFromShareHtml('<html><body>no links here</body></html>')).toEqual({ kind: 'none' });
  });

  it('handles a large / adversarial page without hanging', () => {
    // Many http tokens with no match — the old lazy-quantifier regex was O(n^2)
    // here and could time the function out. This must return quickly.
    const big = 'http://x/' + 'a'.repeat(1_000_000);
    const start = Date.now();
    expect(pickFromShareHtml(big).kind).toBe('none');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
