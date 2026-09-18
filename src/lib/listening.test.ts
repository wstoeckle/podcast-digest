import { beforeEach, expect, it } from 'vitest';
import {
  chooseQueue,
  clearListeningHistory,
  markHeard,
  readDigests,
  rememberDigest,
  type SavedDigest,
} from './listening';
import { addToPlaylist, digestSpeechText, estimateListenSec } from './playlist';
const item = (guid: string, words = 170): SavedDigest => ({
  guid,
  showTitle: 'Show',
  episodeTitle: guid,
  tldr: Array(words).fill('word').join(' '),
  bullets: [],
  topics: [],
  addedAt: 1,
});
beforeEach(() => localStorage.clear());
it('migrates queued digests, deduplicates updates, and preserves heard history', () => {
  addToPlaylist(item('a'));
  expect(readDigests()).toHaveLength(1);
  markHeard(item('a'));
  rememberDigest({ ...item('a'), tldr: 'Updated' });
  expect(readDigests()).toHaveLength(1);
  expect(readDigests()[0]?.heardAt).toBeGreaterThan(0);
  expect(readDigests()[0]?.tldr).toBe('Updated');
  clearListeningHistory();
  expect(readDigests()[0]?.heardAt).toBeUndefined();
});
it('ignores malformed local data', () => {
  localStorage.setItem('pd.listening.v1', JSON.stringify([{ ...item('a'), bullets: [42] }, null]));
  expect(readDigests()).toEqual([]);
});
it('never exceeds the budget and can fit shorter items after skipping a long one', () => {
  const items = [item('long', 1700), item('a', 340), item('b', 510)];
  const ranks = [
    { guid: 'long', relevance: 3, novelty: 3 },
    { guid: 'a', relevance: 2.8, novelty: 3 },
    { guid: 'b', relevance: 2.5, novelty: 2 },
  ];
  const queue = chooseQueue(items, ranks, 5, 1);
  expect(queue.map((d) => d.guid)).toEqual(['a', 'b']);
  expect(
    queue.reduce((sum, d) => sum + estimateListenSec(digestSpeechText(d), 1), 0),
  ).toBeLessThanOrEqual(300);
  expect(chooseQueue(items, ranks, 5, 2).map((d) => d.guid)).toEqual(['long']);
});
it('does not fill a queue with irrelevant or heard items; empty/no-match results are valid', () => {
  expect(
    chooseQueue(
      [{ ...item('a'), heardAt: 1 }, item('b')],
      [
        { guid: 'a', relevance: 3, novelty: 3 },
        { guid: 'b', relevance: 1, novelty: 3 },
      ],
      20,
      1,
    ),
  ).toEqual([]);
  expect(chooseQueue([item('a')], [], 20, 1)).toEqual([]);
});
