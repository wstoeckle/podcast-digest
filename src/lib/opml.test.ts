import { describe, it, expect } from 'vitest';
import { parseOpml } from './opml';

describe('parseOpml', () => {
  it('parses a Pocket Casts-style export (nested outlines, text attr)', () => {
    const opml = `<?xml version="1.0" encoding="utf-8"?>
<opml version="1.0">
  <head><title>Pocket Casts Feeds</title></head>
  <body>
    <outline text="feeds">
      <outline type="rss" text="Invest Like the Best" xmlUrl="https://feeds.megaphone.fm/investlikethebest" />
      <outline type="rss" text="Acquired" xmlUrl="https://feeds.transistor.fm/acquired" />
    </outline>
  </body>
</opml>`;
    expect(parseOpml(opml)).toEqual([
      { title: 'Invest Like the Best', feedUrl: 'https://feeds.megaphone.fm/investlikethebest' },
      { title: 'Acquired', feedUrl: 'https://feeds.transistor.fm/acquired' },
    ]);
  });

  it('prefers title over text, decodes entities, tolerates single quotes', () => {
    const opml = `<opml><body>
      <outline title="Tom &amp; Jerry&#39;s Show" text="fallback" xmlUrl='https://example.com/feed?a=1&amp;b=2'/>
    </body></opml>`;
    expect(parseOpml(opml)).toEqual([
      { title: "Tom & Jerry's Show", feedUrl: 'https://example.com/feed?a=1&b=2' },
    ]);
  });

  it('skips grouping outlines without xmlUrl and non-http urls, dedupes by feed', () => {
    const opml = `<opml><body>
      <outline text="just a folder">
        <outline text="A" xmlUrl="https://example.com/a"/>
        <outline text="A again" xmlUrl="HTTPS://EXAMPLE.COM/A"/>
        <outline text="local" xmlUrl="file:///etc/passwd"/>
      </outline>
    </body></opml>`;
    expect(parseOpml(opml)).toEqual([{ title: 'A', feedUrl: 'https://example.com/a' }]);
  });

  it('falls back to the feed URL when no title/text is present', () => {
    expect(parseOpml('<outline xmlUrl="https://example.com/f"/>')).toEqual([
      { title: 'https://example.com/f', feedUrl: 'https://example.com/f' },
    ]);
  });

  it('returns empty for documents with no subscriptions', () => {
    expect(parseOpml('<opml><body><outline text="empty folder"/></body></opml>')).toEqual([]);
    expect(parseOpml('not xml at all')).toEqual([]);
  });
});
