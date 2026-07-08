import { describe, it, expect } from 'vitest';
import { parseFeed, hashId, stripHtml } from './rss';

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>The Sample Show</title>
    <itunes:author>Jane Host</itunes:author>
    <description><![CDATA[A show about <b>things</b>.]]></description>
    <itunes:image href="https://cdn.example.com/art.jpg"/>
    <item>
      <title>Episode One: Beginnings</title>
      <guid isPermaLink="false">ep-0001</guid>
      <pubDate>Mon, 06 Jul 2026 10:00:00 GMT</pubDate>
      <itunes:duration>1:02:30</itunes:duration>
      <description>The first &amp; finest episode.</description>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="1"/>
      <podcast:transcript url="https://cdn.example.com/ep1.vtt" type="text/vtt"/>
    </item>
    <item>
      <title>Episode Two</title>
      <itunes:duration>2400</itunes:duration>
      <enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

describe('parseFeed', () => {
  const result = parseFeed(FEED, 'https://example.com/feed.xml');

  it('reads the channel header', () => {
    expect(result.show.title).toBe('The Sample Show');
    expect(result.show.author).toBe('Jane Host');
    expect(result.show.artwork).toBe('https://cdn.example.com/art.jpg');
    expect(result.show.feedUrl).toBe('https://example.com/feed.xml');
    expect(result.show.description).toBe('A show about things.');
  });

  it('parses every item', () => {
    expect(result.episodes).toHaveLength(2);
  });

  it('extracts episode fields, decoding entities', () => {
    const [one] = result.episodes;
    expect(one?.title).toBe('Episode One: Beginnings');
    expect(one?.guid).toBe('ep-0001');
    expect(one?.audioUrl).toBe('https://cdn.example.com/ep1.mp3');
    expect(one?.durationSec).toBe(3750); // 1:02:30
    expect(one?.description).toBe('The first & finest episode.');
    expect(one?.publishedAt).toBe('2026-07-06T10:00:00.000Z');
  });

  it('captures the podcast:transcript tag', () => {
    const [one] = result.episodes;
    expect(one?.transcriptUrl).toBe('https://cdn.example.com/ep1.vtt');
    expect(one?.transcriptType).toBe('text/vtt');
  });

  it('falls back to an audio-hash guid when guid is missing', () => {
    const two = result.episodes[1];
    expect(two?.guid).toBe(hashId('https://cdn.example.com/ep2.mp3'));
    expect(two?.durationSec).toBe(2400);
    expect(two?.transcriptUrl).toBeUndefined();
  });

  it('is resilient to an empty / junk feed', () => {
    const empty = parseFeed('<rss><channel></channel></rss>', 'u');
    expect(empty.episodes).toHaveLength(0);
    expect(empty.show.title).toBe('Untitled podcast');
  });
});

describe('hashId', () => {
  it('is stable and url-safe', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('x')).toMatch(/^[a-z0-9]+$/);
  });
});

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });
});
