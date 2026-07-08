// OPML import — the standard "here are the shows I follow" export that podcast
// apps produce (Pocket Casts: Profile → Settings → Export Podcasts; Apple,
// Overcast, Castro all export the same shape). Pure and regex-based like
// rss.ts, so it runs in the browser and in tests with no DOMParser.

import { decodeEntities } from './rss.js';

export interface OpmlShow {
  title: string;
  feedUrl: string;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  if (!m) return undefined;
  const v = decodeEntities(m[1] ?? m[2] ?? '');
  return v || undefined;
}

/**
 * Extract podcast subscriptions from an OPML document. Tolerant by design:
 * any <outline> with an xmlUrl counts, nesting/type attributes are ignored,
 * and duplicates (same feed URL) collapse to the first occurrence.
 */
export function parseOpml(xml: string): OpmlShow[] {
  const shows: OpmlShow[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<outline\b[^>]*>/gi)) {
    const tag = m[0];
    const feedUrl = attr(tag, 'xmlUrl');
    if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) continue;
    const key = feedUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const title = attr(tag, 'title') ?? attr(tag, 'text') ?? feedUrl;
    shows.push({ title, feedUrl });
  }
  return shows;
}
