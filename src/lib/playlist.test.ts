import { describe, it, expect, beforeEach } from 'vitest';
import {
  addToPlaylist,
  digestSpeechText,
  estimateListenSec,
  inPlaylist,
  moveItem,
  movePlaylistItem,
  readPlaylist,
  removeFromPlaylist,
} from './playlist';

const item = (guid: string) => ({
  guid,
  feedUrl: 'https://example.com/feed',
  showTitle: 'Show',
  episodeTitle: `Episode ${guid}`,
  tldr: 'The gist.',
  bullets: ['One.', 'Two.'],
});

describe('playlist store', () => {
  beforeEach(() => localStorage.clear());

  it('appends to the end and reports membership', () => {
    addToPlaylist(item('a'));
    addToPlaylist(item('b'));
    expect(readPlaylist().map((i) => i.guid)).toEqual(['a', 'b']);
    expect(inPlaylist('a')).toBe(true);
    expect(inPlaylist('zzz')).toBe(false);
  });

  it('re-adding an episode replaces the stale copy at the end', () => {
    addToPlaylist(item('a'));
    addToPlaylist(item('b'));
    addToPlaylist({ ...item('a'), tldr: 'Updated gist.' });
    const items = readPlaylist();
    expect(items.map((i) => i.guid)).toEqual(['b', 'a']);
    expect(items[1]?.tldr).toBe('Updated gist.');
  });

  it('removes and reorders', () => {
    addToPlaylist(item('a'));
    addToPlaylist(item('b'));
    addToPlaylist(item('c'));
    expect(movePlaylistItem('c', -1).map((i) => i.guid)).toEqual(['a', 'c', 'b']);
    expect(removeFromPlaylist('a').map((i) => i.guid)).toEqual(['c', 'b']);
  });
});

describe('moveItem', () => {
  const items = [{ guid: 'a' }, { guid: 'b' }, { guid: 'c' }];

  it('moves within bounds and is a no-op at the edges', () => {
    expect(moveItem(items, 'b', -1).map((i) => i.guid)).toEqual(['b', 'a', 'c']);
    expect(moveItem(items, 'a', -1)).toBe(items);
    expect(moveItem(items, 'c', 1)).toBe(items);
    expect(moveItem(items, 'missing', 1)).toBe(items);
  });
});

describe('speech helpers', () => {
  it('joins tldr and bullets, skipping empty parts', () => {
    expect(digestSpeechText({ tldr: 'Gist.', bullets: ['A.', 'B.'] })).toBe(
      'Gist. Key points. A. B.',
    );
    expect(digestSpeechText({ tldr: 'Gist.', bullets: [] })).toBe('Gist.');
  });

  it('estimates listen time scaled by rate', () => {
    const text = Array.from({ length: 170 }, () => 'word').join(' '); // 1 min at 1×
    expect(estimateListenSec(text, 1)).toBe(60);
    expect(estimateListenSec(text, 2)).toBe(30);
    expect(estimateListenSec('', 1)).toBe(0);
  });
});
