// GET /api/search?q=... — proxy the free, keyless iTunes Search API for
// podcasts and return a normalized list of shows (with feed URLs).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SearchResultShow } from '../src/types';
import { fetchWithTimeout, methodNotAllowed, str } from './_lib/http.js';

interface ItunesPodcast {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const q = str(req.query.q);
  if (!q) {
    res.status(400).json({ error: 'missing q' });
    return;
  }

  const url =
    'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=' +
    encodeURIComponent(q);

  try {
    const r = await fetchWithTimeout(url, 10000);
    if (!r.ok) {
      res.status(502).json({ error: `itunes search failed: ${r.status}` });
      return;
    }
    const data = (await r.json()) as { results?: ItunesPodcast[] };
    const shows: SearchResultShow[] = (data.results ?? [])
      .filter((p) => p.feedUrl && p.collectionName)
      .map((p) => {
        const s: SearchResultShow = {
          id: String(p.collectionId ?? p.feedUrl),
          title: p.collectionName as string,
          feedUrl: p.feedUrl as string,
        };
        if (p.artistName) s.author = p.artistName;
        const art = p.artworkUrl600 ?? p.artworkUrl100;
        if (art) s.artwork = art;
        return s;
      });

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({ shows });
  } catch (err) {
    res.status(502).json({ error: `search error: ${(err as Error).message}` });
  }
}
