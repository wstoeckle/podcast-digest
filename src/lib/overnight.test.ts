import { describe, expect, it } from 'vitest';
import { feedKey, pickerRows } from './overnight';

describe('pickerRows', () => {
  const following = [
    { feedUrl: 'https://Feeds.Example.com/b', title: 'Bravo' },
    { feedUrl: 'https://feeds.example.com/a', title: 'Alpha', artwork: 'https://img.test/a.png' },
    { feedUrl: 'https://feeds.example.com/a', title: 'Alpha dup' },
  ];

  it('marks picks, matching URLs the way the server stores them', () => {
    const rows = pickerRows(following, [
      { feedUrl: 'https://feeds.example.com/b', title: 'Bravo' },
    ]);
    expect(rows).toEqual([
      {
        feedUrl: 'https://feeds.example.com/a',
        title: 'Alpha',
        artwork: 'https://img.test/a.png',
        chosen: false,
        followed: true,
      },
      { feedUrl: 'https://Feeds.Example.com/b', title: 'Bravo', chosen: true, followed: true },
    ]);
  });

  it('keeps picks made on another device, so they can be removed here', () => {
    const rows = pickerRows([], [{ feedUrl: 'https://x.test/rss', title: 'Elsewhere' }]);
    expect(rows).toEqual([
      { feedUrl: 'https://x.test/rss', title: 'Elsewhere', chosen: true, followed: false },
    ]);
  });

  it('normalizes feed URLs like URL.toString', () => {
    expect(feedKey('https://Example.COM/feed')).toBe('https://example.com/feed');
    expect(feedKey('not a url')).toBe('not a url');
  });
});
