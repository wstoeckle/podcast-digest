// POST /api/resolve { url } — turn a pasted link into a feed URL (+ optional
// episode guid). Handles raw RSS, Apple Podcasts (via the iTunes lookup API),
// Pocket Casts share links (best-effort HTML scrape), Spotify episode/show
// links (oEmbed title → iTunes search → RSS), and direct audio URLs.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ResolveResult } from '../src/types.js';
import { classifyLink, pickFromShareHtml } from '../src/lib/resolveUrl.js';
import { fetchWithTimeout, jsonBody, methodNotAllowed, str } from './_lib/http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const url = str(jsonBody(req).url);
  if (!url) {
    res.status(400).json({ error: 'missing url' });
    return;
  }

  const parsed = classifyLink(url);
  try {
    switch (parsed.kind) {
      case 'feed': {
        res.status(200).json({ kind: 'feed', feedUrl: parsed.feedUrl } satisfies ResolveResult);
        return;
      }
      case 'audio': {
        res.status(200).json({ kind: 'audio', audioUrl: parsed.audioUrl } satisfies ResolveResult);
        return;
      }
      case 'apple': {
        const out = await resolveApple(parsed.appleCollectionId, parsed.appleEpisodeId);
        res.status(out.feedUrl ? 200 : 422).json(out);
        return;
      }
      case 'pocketcasts': {
        const out = await resolvePocketCasts(parsed.pocketCastsUrl as string);
        res.status(out.kind === 'unknown' ? 422 : 200).json(out);
        return;
      }
      case 'spotify': {
        const out = await resolveSpotify(parsed.spotifyUrl as string);
        res.status(out.kind === 'unknown' ? 422 : 200).json(out);
        return;
      }
      default:
        res.status(422).json({
          kind: 'unknown',
          error: "Couldn't recognize that link. Paste an RSS feed URL, or search for the show.",
        } satisfies ResolveResult & { error: string });
    }
  } catch (err) {
    res.status(502).json({ kind: 'unknown', error: (err as Error).message });
  }
}

interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  feedUrl?: string;
  episodeGuid?: string;
  collectionId?: number;
  trackName?: string;
  collectionName?: string;
}

async function resolveApple(
  collectionId: string | undefined,
  episodeId: string | undefined,
): Promise<ResolveResult & { error?: string }> {
  const id = collectionId ?? episodeId;
  if (!id) return { kind: 'unknown', error: 'no Apple id in link' };

  const r = await fetchWithTimeout(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcastEpisode&limit=1`,
    10000,
  );
  if (!r.ok) return { kind: 'apple', error: `itunes lookup failed: ${r.status}` };
  const data = (await r.json()) as { results?: ItunesResult[] };
  const results = data.results ?? [];
  const feedUrl = results.find((x) => x.feedUrl)?.feedUrl;
  if (!feedUrl) return { kind: 'apple', error: 'no feed URL for that Apple show' };

  const out: ResolveResult = { kind: 'apple', feedUrl };
  // If the link referenced a specific episode and iTunes gave us its guid,
  // pass it along so we can open straight to that episode.
  if (episodeId) {
    const guid = results.find((x) => x.wrapperType === 'podcastEpisode' && x.episodeGuid)
      ?.episodeGuid;
    if (guid) out.guid = guid;
  }
  return out;
}

// Spotify's catalog is a walled garden — no API response ever includes an RSS
// URL. But its keyless oEmbed endpoint returns the exact episode/show title,
// and the iTunes Search API can map that title back to the open-web copy of
// the same podcast (feed URL + episode guid). Works for anything that is a
// real podcast; Spotify *exclusives* have no RSS anywhere, so those fail with
// a clear message pointing at search instead.
async function resolveSpotify(link: string): Promise<ResolveResult & { error?: string }> {
  const cantOpen = {
    kind: 'unknown' as const,
    error:
      "Couldn't open that Spotify link. If the show is a Spotify exclusive there's no public feed for it — otherwise try searching for the show above.",
  };

  // spotify.link short links redirect to open.spotify.com; follow first.
  let target = link;
  try {
    if (new URL(link).hostname.toLowerCase() === 'spotify.link') {
      const r = await fetchWithTimeout(link, 10000);
      target = r.url || link;
    }
  } catch {
    return cantOpen;
  }

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return cantOpen;
  }
  const type = u.pathname.split('/').filter(Boolean).find((p) => p === 'episode' || p === 'show');
  if (!type) return cantOpen;

  let title: string | undefined;
  try {
    const r = await fetchWithTimeout(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(u.origin + u.pathname)}`,
      10000,
    );
    if (r.ok) title = ((await r.json()) as { title?: string }).title?.trim();
  } catch {
    /* fall through to cantOpen */
  }
  if (!title) return cantOpen;

  // The oEmbed title is the episode title for /episode links — but for /show
  // links it can be EITHER the show name or the show's latest episode title
  // (observed live). So search the matching entity first, and fall back to the
  // other one; an exact title match beats a fuzzy first hit in both passes.
  const primary = type === 'episode' ? 'podcastEpisode' : 'podcast';
  const fallback = type === 'episode' ? 'podcast' : 'podcastEpisode';
  const match =
    (await searchItunes(title, primary)) ?? (await searchItunes(title, fallback));
  if (!match?.feedUrl) return cantOpen;

  const out: ResolveResult = { kind: 'spotify', feedUrl: match.feedUrl };
  if (type === 'episode' && match.episodeGuid) out.guid = match.episodeGuid;
  return out;
}

/** iTunes search for `title`; exact title match wins, else the first hit with a feed. */
async function searchItunes(
  title: string,
  entity: 'podcast' | 'podcastEpisode',
): Promise<ItunesResult | undefined> {
  const r = await fetchWithTimeout(
    `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=podcast&entity=${entity}&limit=5`,
    10000,
  );
  if (!r.ok) return undefined;
  const results = ((await r.json()) as { results?: ItunesResult[] }).results ?? [];
  const wanted = title.toLowerCase();
  const usable = results.filter((x) => x.feedUrl);
  return (
    usable.find(
      (x) => x.trackName?.toLowerCase() === wanted || x.collectionName?.toLowerCase() === wanted,
    ) ?? usable[0]
  );
}

// Pocket Casts has no public API. Their share pages (pca.st 302-redirects to
// pocketcasts.com) embed enough to find the underlying show or the episode
// audio; we scrape best-effort with a backtracking-safe, size-capped parser and
// fall back to asking the user to paste the RSS or search instead.
async function resolvePocketCasts(shareUrl: string): Promise<ResolveResult & { error?: string }> {
  const cantOpen = {
    kind: 'unknown' as const,
    error:
      "Couldn't open that Pocket Casts link. Try pasting the show's RSS URL, or search for it above.",
  };

  let html: string;
  try {
    const r = await fetchWithTimeout(shareUrl, 12000);
    if (!r.ok) return cantOpen;
    html = await r.text();
  } catch {
    return cantOpen;
  }

  const pick = pickFromShareHtml(html);
  switch (pick.kind) {
    case 'feed':
      return { kind: 'feed', feedUrl: pick.url };
    case 'audio':
      return { kind: 'audio', audioUrl: pick.url };
    case 'apple': {
      const p = classifyLink(pick.url as string);
      if (p.kind === 'apple') return resolveApple(p.appleCollectionId, p.appleEpisodeId);
      return cantOpen;
    }
    default:
      return {
        kind: 'unknown',
        error:
          "Couldn't extract the show from that Pocket Casts link. Try pasting the show's RSS URL, or search for it above.",
      };
  }
}
