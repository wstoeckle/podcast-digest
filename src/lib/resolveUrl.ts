// Classify and normalize a pasted link into something we can fetch. Handles:
//   - a raw RSS feed URL
//   - an Apple Podcasts URL (podcasts.apple.com/.../id123456789?i=100000...)
//   - a Pocket Casts share link (pca.st/... or pocketcasts.com/...)
//   - a Spotify episode/show link (open.spotify.com/... or spotify.link/...)
//   - a direct audio file URL
// The pure part is classification + extracting the Apple ids; turning those
// ids into a feed URL requires a network call (iTunes lookup / following the
// share redirect), which the /api/resolve endpoint does. Kept pure + tested.

import type { ResolveResult } from '../types.js';

const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|m4b|flac)(\?|#|$)/i;

export interface ParsedLink {
  kind: ResolveResult['kind'];
  /** Apple collection id (the numeric after /id). */
  appleCollectionId?: string;
  /** Apple episode id (the ?i= param). */
  appleEpisodeId?: string;
  /** For pocketcasts, the share slug we still need to follow server-side. */
  pocketCastsUrl?: string;
  /** For spotify, the link we resolve server-side (oEmbed title → iTunes → RSS). */
  spotifyUrl?: string;
  feedUrl?: string;
  audioUrl?: string;
}

export function classifyLink(input: string): ParsedLink {
  const raw = input.trim();
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL — maybe someone pasted "domain.com/feed" without a scheme.
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return { kind: 'unknown' };
    }
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // Apple Podcasts
  if (host === 'podcasts.apple.com' || host === 'itunes.apple.com') {
    const idMatch = /\/id(\d+)/.exec(url.pathname);
    const out: ParsedLink = { kind: 'apple' };
    if (idMatch) out.appleCollectionId = idMatch[1];
    const ep = url.searchParams.get('i');
    if (ep) out.appleEpisodeId = ep;
    return out;
  }

  // Pocket Casts share links
  if (host === 'pca.st' || host === 'pocketcasts.com' || host.endsWith('.pocketcasts.com')) {
    return { kind: 'pocketcasts', pocketCastsUrl: url.toString() };
  }

  // Spotify episode/show links (and their spotify.link short links)
  if (host === 'open.spotify.com' || host === 'spotify.link') {
    return { kind: 'spotify', spotifyUrl: url.toString() };
  }

  // Direct audio file
  if (AUDIO_RE.test(url.pathname)) {
    return { kind: 'audio', audioUrl: url.toString() };
  }

  // Otherwise assume it's a feed URL (rss/xml, or a path that looks feed-y).
  return { kind: 'feed', feedUrl: url.toString() };
}

/** True if a string looks like a direct audio URL. */
export function looksLikeAudio(u: string): boolean {
  return AUDIO_RE.test(u);
}

export interface HtmlPick {
  kind: 'feed' | 'apple' | 'audio' | 'none';
  url?: string;
}

// A single greedy character class — linear, no nested/lazy quantifiers, so it
// can't catastrophically backtrack on a large or hostile page.
const HTML_URL_RE = /https?:\/\/[^\s"'<>()\\]+/gi;

/**
 * Best-effort extraction of a resolvable link from a Pocket Casts (or similar)
 * share page: an RSS feed, an Apple Podcasts URL, or the episode audio. Pure,
 * size-capped, and backtracking-safe so it can never hang the serverless
 * function (the earlier lazy-quantifier regexes could go O(n^2) on big pages
 * and time the request out — surfacing as a 500).
 */
export function pickFromShareHtml(html: string): HtmlPick {
  const doc = html.length > 800_000 ? html.slice(0, 800_000) : html;

  // Structured hints first — a declared RSS feed is the most reliable signal.
  const rss = attrOf(doc, /<link\b[^>]*\btype=["']application\/rss\+xml["'][^>]*>/i, 'href');
  if (rss) return { kind: 'feed', url: decodeAmp(rss) };

  const urls = (doc.match(HTML_URL_RE) ?? []).slice(0, 8000).map(decodeAmp);

  const feed = urls.find(
    (u) => /(?:\.xml|\.rss|\/rss|\/feed)(?:$|[?#/])/i.test(u) && !/apple\.com/i.test(u),
  );
  if (feed) return { kind: 'feed', url: feed };

  const apple = urls.find((u) => /^https?:\/\/podcasts\.apple\.com\//i.test(u));
  if (apple) return { kind: 'apple', url: apple };

  const ogAudio = attrOf(doc, /<meta\b[^>]*\bproperty=["']og:audio["'][^>]*>/i, 'content');
  const audio = (ogAudio && decodeAmp(ogAudio)) || urls.find((u) => AUDIO_RE.test(u));
  if (audio) return { kind: 'audio', url: audio };

  return { kind: 'none' };
}

function attrOf(html: string, tagRe: RegExp, attr: string): string | undefined {
  const tag = tagRe.exec(html)?.[0];
  if (!tag) return undefined;
  const m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"|${attr}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? undefined) : undefined;
}

function decodeAmp(s: string): string {
  return s.replace(/&amp;/gi, '&');
}
