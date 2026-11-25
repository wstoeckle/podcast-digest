// GET /api/access[?check=1] — whose keys this device's requests would use, for
// the Settings screen: the owner's (owner code accepted), the caller's own, or
// none. With ?check=1 it also asks Anthropic and AssemblyAI whether the
// caller's own keys work, using free calls (listing models / transcripts).
// Never echoes a key back.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AccessStatus } from '../src/types.js';
import { access } from './_lib/access.js';
import { checkClaudeKey } from './_lib/anthropic.js';
import { methodNotAllowed } from './_lib/http.js';
import { rateLimit, tooMany } from './_lib/ratelimit.js';
import { checkSttKey } from './_lib/stt.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const a = access(req);
  const out: AccessStatus = {
    owner: a.owner,
    ownerCode: Boolean(process.env.OWNER_CODE?.trim()),
    claude: a.claude.use,
    stt: a.stt.use,
  };

  if (req.query.check === '1' && (a.claude.use === 'caller' || a.stt.use === 'caller')) {
    // Free calls, but don't let this become a key-testing service.
    const rl = await rateLimit(req, { name: 'keycheck', perHour: 30, globalPerHour: 300 });
    if (rl && !rl.ok) return tooMany(res, rl);
    const [claude, stt] = await Promise.all([
      a.claude.use === 'caller' && a.claude.key ? checkClaudeKey(a.claude.key) : undefined,
      a.stt.use === 'caller' && a.stt.key ? checkSttKey(a.stt.key) : undefined,
    ]);
    if (claude) out.claudeKey = claude;
    if (stt) out.sttKey = stt;
  }

  res.status(200).json(out);
}
