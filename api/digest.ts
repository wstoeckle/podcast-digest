// POST /api/digest { guid, transcript?, showTitle?, episodeTitle? }
// Returns { tldr, bullets, topics, outline, quotes }. Cached per guid (per
// prompt version) and shared by everyone, so a digest someone already made is
// free for the next person.
//
// Only digests of the shared transcript (the one /api/transcript found and
// cached) are cached or served from the cache. A different transcript in the
// request (one the user pasted) gets its own digest, kept off the shared cache,
// so nobody can swap what everyone else sees for an episode.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Digest } from '../src/types.js';
import { CLAUDE_KEY_REJECTED, NEEDS_CLAUDE_KEY, access } from './_lib/access.js';
import { generateDigest, isKeyRejected } from './_lib/anthropic.js';
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
  const shared = (await getCachedTranscript(guid))?.trim() || null;
  const supplied = str(body.transcript);
  // The request is about the shared transcript: no text sent, or the same text.
  const isShared = !supplied || supplied === shared;

  if (isShared) {
    const cached = await tryRedis('digest_get', (kv) => kv.get<Digest>(key), null);
    if (cached) {
      res.status(200).json(cached);
      return;
    }
  }

  const transcript = supplied ?? shared;
  if (!transcript) {
    res.status(400).json({ error: 'no transcript available for this episode' });
    return;
  }

  const { claude } = access(req);
  if (claude.use === 'locked') {
    res.status(401).json({ error: NEEDS_CLAUDE_KEY, code: 'needs_key' });
    return;
  }

  const meta = { showTitle: str(body.showTitle), episodeTitle: str(body.episodeTitle) };

  // Meter generations on the app's key; cache hits above already returned, and
  // a caller's own key is theirs to spend.
  if (claude.use === 'server') {
    const rl = await rateLimit(req, {
      name: 'llm',
      perHour: llmPerHour(),
      globalPerHour: llmGlobalPerHour(),
    });
    if (rl && !rl.ok) return tooMany(res, rl);
  }

  try {
    const digest = await generateDigest(transcript, meta, claude.key);
    // Don't cache demo output — a real key later should supersede it.
    if (isShared && !digest.demo) {
      await tryRedis('digest_set', (kv) => kv.set(key, digest, { ex: CACHE_TTL_SECONDS }), null);
    }
    res.status(200).json(digest);
  } catch (err) {
    if (claude.use === 'caller' && isKeyRejected(err)) {
      res.status(401).json({ error: CLAUDE_KEY_REJECTED, code: 'key_rejected' });
      return;
    }
    res.status(502).json({ error: `digest failed: ${(err as Error).message}` });
  }
}
