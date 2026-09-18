import { digestSpeechText, estimateListenSec, readPlaylist, type PlaylistItem } from './playlist';

export interface SavedDigest extends PlaylistItem {
  topics: string[];
  heardAt?: number;
}
export interface ListeningCandidate {
  guid: string;
  title: string;
  show: string;
  tldr: string;
  bullets: string[];
  topics: string[];
}
export interface RecommendationInput {
  interests: string;
  candidates: ListeningCandidate[];
  history: ListeningCandidate[];
}
export interface DigestRank {
  guid: string;
  relevance: number;
  novelty: number;
}
export interface RecommendationResult {
  ranks: DigestRank[];
  model: string;
}
const KEY = 'pd.listening.v1';
const INTERESTS = 'pd.interests.v1';
function valid(v: unknown): v is SavedDigest {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  return (
    ['guid', 'showTitle', 'episodeTitle', 'tldr'].every((k) => typeof x[k] === 'string') &&
    Array.isArray(x.bullets) &&
    x.bullets.every((b) => typeof b === 'string') &&
    Array.isArray(x.topics) &&
    x.topics.every((t) => typeof t === 'string') &&
    typeof x.addedAt === 'number' &&
    Number.isFinite(x.addedAt) &&
    (x.heardAt === undefined || (typeof x.heardAt === 'number' && Number.isFinite(x.heardAt)))
  );
}
export function readDigests(): SavedDigest[] {
  let saved: SavedDigest[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(raw)) saved = raw.filter(valid);
  } catch {
    /* no storage */
  }
  const byId = new Map(saved.map((d) => [d.guid, d]));
  for (const item of readPlaylist()) {
    const migrated = { ...item, topics: [] };
    if (!byId.has(item.guid) && valid(migrated)) byId.set(item.guid, migrated);
  }
  return [...byId.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100);
}
function save(items: SavedDigest[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)));
  } catch {
    /* storage full / disabled */
  }
}
export function rememberDigest(item: Omit<SavedDigest, 'addedAt' | 'heardAt'>) {
  const items = readDigests();
  const old = items.find((d) => d.guid === item.guid);
  save([
    {
      ...item,
      addedAt: old?.addedAt ?? Date.now(),
      ...(old?.heardAt ? { heardAt: old.heardAt } : {}),
    },
    ...items.filter((d) => d.guid !== item.guid),
  ]);
}
export function markHeard(item: PlaylistItem) {
  const items = readDigests();
  const old = items.find((d) => d.guid === item.guid);
  save([
    { ...item, topics: old?.topics ?? [], heardAt: Date.now() },
    ...items.filter((d) => d.guid !== item.guid),
  ]);
}
export function clearListeningHistory() {
  save(readDigests().map(({ heardAt: _heard, ...item }) => item));
}
export function readInterests(): string {
  try {
    return localStorage.getItem(INTERESTS) || '';
  } catch {
    return '';
  }
}
export function saveInterests(text: string) {
  try {
    localStorage.setItem(INTERESTS, text);
  } catch {
    /* no storage */
  }
}
export function candidate(d: SavedDigest): ListeningCandidate {
  return {
    guid: d.guid,
    title: d.episodeTitle,
    show: d.showTitle,
    tldr: d.tldr,
    bullets: d.bullets,
    topics: d.topics,
  };
}
/** Exact text, deterministic duration, no episode-length guessing or model arithmetic. */
export function chooseQueue(
  items: SavedDigest[],
  ranks: DigestRank[],
  minutes: number,
  rate: number,
) {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(rate) || rate <= 0) return [];
  const byId = new Map(ranks.map((r) => [r.guid, r]));
  const ranked = items
    .filter((d) => {
      const r = byId.get(d.guid);
      return (
        !d.heardAt &&
        r &&
        Number.isFinite(r.relevance) &&
        r.relevance >= 1.5 &&
        r.relevance <= 3 &&
        Number.isFinite(r.novelty) &&
        r.novelty >= 0.75 &&
        r.novelty <= 3
      );
    })
    .sort((a, b) => {
      const ra = byId.get(a.guid)!;
      const rb = byId.get(b.guid)!;
      return (
        0.7 * rb.relevance + 0.3 * rb.novelty - (0.7 * ra.relevance + 0.3 * ra.novelty) ||
        b.addedAt - a.addedAt ||
        a.guid.localeCompare(b.guid)
      );
    });
  let remaining = Math.floor(minutes * 60);
  return ranked.filter((d) => {
    const seconds = Math.max(1, estimateListenSec(digestSpeechText(d), rate));
    if (seconds > remaining) return false;
    remaining -= seconds;
    return true;
  });
}
