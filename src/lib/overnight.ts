// Overnight digests on this device: whether they are on, and lining up the
// shows you follow with the ones picked for overnight digests (the server
// keeps the picks, so they are the same on every device). Turning this on
// shares only the shows you pick with the server. Off by default.

const KEY = 'pd.overnight.v1';

export function isOvernightOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setOvernightOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — non-fatal */
  }
}

export interface PickerRow {
  feedUrl: string;
  title: string;
  artwork?: string;
  /** Picked for overnight digests. */
  chosen: boolean;
  /** Followed on this device (a pick can come from another device). */
  followed: boolean;
}

/** The server stores feed URLs as `new URL(u).toString()`; compare in that form. */
export function feedKey(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

/**
 * One row per show you could pick: your followed shows, marked when picked,
 * plus picks made on another device that aren't followed here. A–Z, so rows
 * don't jump around as you tick them.
 */
export function pickerRows(
  following: { feedUrl: string; title: string; artwork?: string }[],
  picked: { feedUrl: string; title: string; artwork?: string }[],
): PickerRow[] {
  const pickedByKey = new Map(picked.map((s) => [feedKey(s.feedUrl), s]));
  const rows: PickerRow[] = [];
  const seen = new Set<string>();
  for (const f of following) {
    const key = feedKey(f.feedUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      feedUrl: f.feedUrl,
      title: f.title,
      ...(f.artwork ? { artwork: f.artwork } : {}),
      chosen: pickedByKey.has(key),
      followed: true,
    });
  }
  for (const [key, s] of pickedByKey) {
    if (seen.has(key)) continue;
    rows.push({
      feedUrl: s.feedUrl,
      title: s.title,
      ...(s.artwork ? { artwork: s.artwork } : {}),
      chosen: true,
      followed: false,
    });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}
