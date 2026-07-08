// GET /api/feed?url=... — fetch an RSS feed server-side (avoids browser CORS)
// and return the parsed show + episodes. Cached briefly in Redis when available.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { FeedResult } from '../src/types';
import { parseFeed } from '../src/lib/rss.js';
import { fetchWithTimeout, methodNotAllowed, safeRemoteUrl, str } from './_lib/http.js';
import { redis } from './_lib/redis.js';

const MAX_EPISODES = 300;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const feedUrl = safeRemoteUrl(str(req.query.url));
  if (!feedUrl) {
    res.status(400).json({ error: 'missing or invalid url' });
    return;
  }
  const key = `feed:${feedUrl.toString()}`;
  const kv = redis();

  try {
    if (kv) {
      const cached = await kv.get<FeedResult>(key);
      if (cached) {
        res.setHeader('Cache-Control', 's-maxage=600');
        res.status(200).json(cached);
        return;
      }
    }

    const r = await fetchWithTimeout(feedUrl.toString(), 15000);
    if (!r.ok) {
      res.status(502).json({ error: `feed fetch failed: ${r.status}` });
      return;
    }
    const xml = await r.text();
    const parsed = parseFeed(xml, feedUrl.toString());
    if (parsed.episodes.length > MAX_EPISODES) {
      parsed.episodes = parsed.episodes.slice(0, MAX_EPISODES);
    }

    if (kv) await kv.set(key, parsed, { ex: 900 });

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: `feed error: ${(err as Error).message}` });
  }
}
