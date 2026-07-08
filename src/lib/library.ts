// Personal library — the episodes you've digested — persisted in localStorage.
// No account, single device, by design.

export interface LibraryItem {
  guid: string;
  feedUrl: string;
  showTitle: string;
  episodeTitle: string;
  artwork?: string;
  /** epoch ms; stored so the list can be shown newest-first. */
  addedAt: number;
}

const KEY = 'pd.library.v1';

export function readLibrary(): LibraryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isItem).sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

function isItem(v: unknown): v is LibraryItem {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as LibraryItem).guid === 'string' &&
    typeof (v as LibraryItem).feedUrl === 'string'
  );
}

function write(items: LibraryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function inLibrary(guid: string): boolean {
  return readLibrary().some((i) => i.guid === guid);
}

export function saveToLibrary(item: Omit<LibraryItem, 'addedAt'>): void {
  const items = readLibrary().filter((i) => i.guid !== item.guid);
  items.unshift({ ...item, addedAt: Date.now() });
  write(items);
}

export function removeFromLibrary(guid: string): void {
  write(readLibrary().filter((i) => i.guid !== guid));
}

export function toggleLibrary(item: Omit<LibraryItem, 'addedAt'>): boolean {
  if (inLibrary(item.guid)) {
    removeFromLibrary(item.guid);
    return false;
  }
  saveToLibrary(item);
  return true;
}
