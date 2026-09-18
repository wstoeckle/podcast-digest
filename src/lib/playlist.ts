// The listen queue — digests stacked up to play back to back (a dog walk's
// worth of episodes). Each item embeds the digest text itself, so playback is
// pure on-device TTS: no network, no re-fetching, works offline once queued.

export interface PlaylistItem {
  guid: string;
  /** Present when the episode can be reopened (feed + guid). */
  feedUrl?: string;
  showTitle: string;
  episodeTitle: string;
  artwork?: string;
  tldr: string;
  bullets: string[];
  addedAt: number;
}

const KEY = 'pd.playlist.v1';

export function readPlaylist(): PlaylistItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isItem);
  } catch {
    return [];
  }
}

function isItem(v: unknown): v is PlaylistItem {
  const it = v as PlaylistItem;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof it.guid === 'string' &&
    typeof it.tldr === 'string' &&
    Array.isArray(it.bullets)
  );
}

function write(items: PlaylistItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function inPlaylist(guid: string): boolean {
  return readPlaylist().some((i) => i.guid === guid);
}

/** Append to the end of the queue (replacing a stale copy of the same episode). */
export function addToPlaylist(item: Omit<PlaylistItem, 'addedAt'>): void {
  const items = readPlaylist().filter((i) => i.guid !== item.guid);
  items.push({ ...item, addedAt: Date.now() });
  write(items);
}

export function removeFromPlaylist(guid: string): PlaylistItem[] {
  const items = readPlaylist().filter((i) => i.guid !== guid);
  write(items);
  return items;
}

export function clearPlaylist(): void {
  write([]);
}

/** Pure reorder helper: move the item one slot up (-1) or down (+1). */
export function moveItem<T extends { guid: string }>(
  items: T[],
  guid: string,
  dir: -1 | 1,
): T[] {
  const from = items.findIndex((i) => i.guid === guid);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [it] = next.splice(from, 1);
  if (!it) return items;
  next.splice(to, 0, it);
  return next;
}

export function movePlaylistItem(guid: string, dir: -1 | 1): PlaylistItem[] {
  const items = moveItem(readPlaylist(), guid, dir);
  write(items);
  return items;
}

/** The text a digest speaks aloud: TLDR then key points. Shared by the episode player and the queue. */
export function digestSpeechText(item: Pick<PlaylistItem, 'tldr' | 'bullets'>): string {
  const points = item.bullets.length ? `Key points. ${item.bullets.join(' ')}` : '';
  return [item.tldr, points].filter(Boolean).join(' ');
}

/**
 * Rough listen time in seconds for `text` at a playback rate. On-device TTS
 * runs ≈170 words/min at 1× — good enough to answer "does this fit my walk?".
 */
export function estimateListenSec(text: string, rate: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const safeRate = rate > 0 ? rate : 1;
  return Math.round((words / (170 * safeRate)) * 60);
}

/** Apply a reviewed plan as one local write. */
export function replacePlaylist(items: PlaylistItem[]): void {
  write(items.map(item => ({ ...item, addedAt: Date.now() })));
}
