// Whose API keys a request may spend.
//
// Friends can use this app with their own keys: the browser keeps them (never
// the server) and sends them with each request in headers. The server's own
// keys (ANTHROPIC_API_KEY, ASSEMBLYAI_API_KEY) are only for the owner: anyone
// whose request carries OWNER_CODE. Without OWNER_CODE set, everyone counts as
// the owner, which is right for a copy only one person uses.
//
// Keys from headers are used for that one request and never stored or logged.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { KEY_HEADERS } from '../../src/lib/keys.js';
import type { KeyErrorCode, KeyUse } from '../../src/types.js';

export type { KeyErrorCode, KeyUse };
export { KEY_HEADERS };

// How a request gets a key for one service (KeyUse):
//   caller  — the caller's own key
//   server  — the app's key (the caller is the owner)
//   locked  — the app has a key, but this caller may not use it
//   demo    — no key anywhere: canned sample content, as in demo mode

export interface ServiceKey {
  use: KeyUse;
  /** The key to call the service with (caller or server use only). */
  key?: string;
}

export interface Access {
  /** The app's owner: the owner code matched, or the app has none. */
  owner: boolean;
  claude: ServiceKey;
  stt: ServiceKey;
}

/** A header value, if it looks like a key or code (one token, sane length). */
function headerValue(req: Pick<VercelRequest, 'headers'>, name: string): string | undefined {
  const raw = req.headers[name];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return v && v.length <= 300 && !/\s/.test(v) ? v : undefined;
}

/** Constant-time comparison that doesn't reveal the code's length. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function serviceKey(
  callerKey: string | undefined,
  serverKey: string | undefined,
  owner: boolean,
): ServiceKey {
  if (callerKey) return { use: 'caller', key: callerKey };
  if (serverKey) return owner ? { use: 'server', key: serverKey } : { use: 'locked' };
  return { use: 'demo' };
}

export function access(req: Pick<VercelRequest, 'headers'>): Access {
  const code = process.env.OWNER_CODE?.trim();
  const given = headerValue(req, KEY_HEADERS.owner);
  const owner = !code || (given !== undefined && sameSecret(given, code));
  return {
    owner,
    claude: serviceKey(
      headerValue(req, KEY_HEADERS.anthropic),
      process.env.ANTHROPIC_API_KEY?.trim() || undefined,
      owner,
    ),
    stt: serviceKey(
      headerValue(req, KEY_HEADERS.assemblyai),
      process.env.ASSEMBLYAI_API_KEY?.trim() || undefined,
      owner,
    ),
  };
}

export const NEEDS_CLAUDE_KEY =
  'Making digests and answering questions needs an Anthropic API key. Add yours in Settings.';
export const NEEDS_STT_KEY =
  "There's no published transcript for this episode, and transcribing the audio needs an AssemblyAI key. Add yours in Settings, or paste the transcript.";
export const CLAUDE_KEY_REJECTED =
  'Anthropic turned down your API key. Check it in Settings (and that the account has credit).';
export const STT_KEY_REJECTED = 'AssemblyAI turned down your API key. Check it in Settings.';
export const OWNER_ONLY = "That's only available to this app's owner.";
