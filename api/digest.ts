// POST /api/digest { guid, transcript?, showTitle?, episodeTitle? }
// Returns { tldr, bullets, topics }. Cached per guid (per prompt version).
// The transcript comes from the request body, or from the Redis cache the
// transcript endpoint populated.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Digest } from '../src/types.js';
import { generateDigest } from './_lib/anthropic.js';
import { jsonBody, methodNotAllowed, str } from './_lib/http.js';
import { llmGlobalPerHour, llmPerHour, rateLimit, tooMany } from './_lib/ratelimit.js';
import { CACHE_TTL_SECONDS, tryRedis } from './_lib/redis.js';
import { digestKey, getCachedTranscript } from './_lib/transcripts.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const body = jsonBody(req);
  const guid = str(body.guid);
  if (!guid) {
    res.status(400).json({ error: 'missing guid' });
    return;
  }

  const key = digestKey(guid);

  const cached = await tryRedis('digest_get', (kv) => kv.get<Digest>(key), null);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  const transcript = str(body.transcript) ?? (await getCachedTranscript(guid));
  if (!transcript) {
    res.status(400).json({ error: 'no transcript available for this episode' });
    return;
  }

  const meta = { showTitle: str(body.showTitle), episodeTitle: str(body.episodeTitle) };

  // Only meter actual generations — cache hits above already returned.
  const rl = await rateLimit(req, {
    name: 'llm',
    perHour: llmPerHour(),
    globalPerHour: llmGlobalPerHour(),
  });
  if (rl && !rl.ok) return tooMany(res, rl);

  try {
    const digest = await generateDigest(transcript, meta);
    // Don't cache demo output — a real key later should supersede it.
    if (!digest.demo) {
      await tryRedis('digest_set', (kv) => kv.set(key, digest, { ex: CACHE_TTL_SECONDS }), null);
    }
    res.status(200).json(digest);
  } catch (err) {
    res.status(502).json({ error: `digest failed: ${(err as Error).message}` });
  }
}
