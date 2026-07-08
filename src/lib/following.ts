// Shows you follow — a lightweight subscription list in localStorage, filled
// by OPML import (Pocket Casts etc.) or the Follow button on a show page.
// Like the library: personal, single device, no account.

export interface FollowedShow {
  feedUrl: string;
  title: string;
  artwork?: string;
  /** epoch ms, for stable ordering (oldest follow first — like a podcast app). */
  addedAt: number;
}

const KEY = 'pd.following.v1';

export function readFollowing(): FollowedShow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isShow).sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}

function isShow(v: unknown): v is FollowedShow {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as FollowedShow).feedUrl === 'string' &&
    typeof (v as FollowedShow).title === 'string'
  );
}

function write(shows: FollowedShow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(shows));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function isFollowing(feedUrl: string): boolean {
  const key = feedUrl.toLowerCase();
  return readFollowing().some((s) => s.feedUrl.toLowerCase() === key);
}

export function followShow(show: Omit<FollowedShow, 'addedAt'>): void {
  const key = show.feedUrl.toLowerCase();
  const shows = readFollowing().filter((s) => s.feedUrl.toLowerCase() !== key);
  shows.push({ ...show, addedAt: Date.now() });
  write(shows);
}

export function unfollowShow(feedUrl: string): void {
  const key = feedUrl.toLowerCase();
  write(readFollowing().filter((s) => s.feedUrl.toLowerCase() !== key));
}

export function toggleFollow(show: Omit<FollowedShow, 'addedAt'>): boolean {
  if (isFollowing(show.feedUrl)) {
    unfollowShow(show.feedUrl);
    return false;
  }
  followShow(show);
  return true;
}

/** Bulk-add (OPML import). Existing follows keep their entry. Returns how many were new. */
export function importFollowing(shows: Array<Omit<FollowedShow, 'addedAt'>>): number {
  const existing = readFollowing();
  const have = new Set(existing.map((s) => s.feedUrl.toLowerCase()));
  const now = Date.now();
  let added = 0;
  for (const s of shows) {
    const key = s.feedUrl.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    existing.push({ ...s, addedAt: now + added });
    added++;
  }
  if (added > 0) write(existing);
  return added;
}
