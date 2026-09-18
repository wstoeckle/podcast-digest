import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForYou from './ForYou';
import { recommendDigests } from '../net/api';
import { rememberDigest, type RecommendationResult } from '../lib/listening';
import { readPlaylist } from '../lib/playlist';
vi.mock('../net/api', () => ({ recommendDigests: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  rememberDigest({
    guid: 'a',
    episodeTitle: 'Climate insights',
    showTitle: 'Show',
    tldr: 'Controls improve efficiency.',
    bullets: [],
    topics: ['climate'],
  });
});
function open() {
  render(
    <MemoryRouter>
      <ForYou />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('What are you interested in right now?'), {
    target: { value: 'Climate' },
  });
}
it('previews recommendations before replacing the queue and changing time does not rerun AI', async () => {
  vi.mocked(recommendDigests).mockResolvedValue({
    model: 'test',
    ranks: [{ guid: 'a', relevance: 3, novelty: 3 }],
  });
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Build listening plan' }));
  await screen.findByText('Climate insights');
  expect(readPlaylist()).toEqual([]);
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '5' } });
  expect(recommendDigests).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Replace listen queue with this plan' }));
  expect(readPlaylist().map((d) => d.guid)).toEqual(['a']);
});
it('discards a late answer when the interests changed while it was running', async () => {
  let finish!: (r: RecommendationResult) => void;
  vi.mocked(recommendDigests).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Build listening plan' }));
  fireEvent.change(screen.getByLabelText('What are you interested in right now?'), {
    target: { value: 'Music' },
  });
  await act(async () =>
    finish({ model: 'test', ranks: [{ guid: 'a', relevance: 3, novelty: 3 }] }),
  );
  expect(screen.queryByText('Climate insights')).not.toBeInTheDocument();
  expect(readPlaylist()).toEqual([]);
});
