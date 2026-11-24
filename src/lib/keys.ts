// Your own API keys and the owner code, kept on this device only
// (localStorage). The app sends them with each request, in headers, so the
// server can spend your keys instead of the app owner's; the server never
// stores them. See api/_lib/access.ts.

/** Request headers, shared with the server so the names can't drift. */
export const KEY_HEADERS = {
  anthropic: 'x-anthropic-key',
  assemblyai: 'x-assemblyai-key',
  owner: 'x-owner-code',
} as const;

export interface StoredKeys {
  anthropicKey?: string;
  assemblyAiKey?: string;
  ownerCode?: string;
}

const STORAGE_KEY = 'pd.keys';

/** A key or code as typed: trimmed, one token, or nothing. */
function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= 300 && !/\s/.test(t) ? t : undefined;
}

function tidy(k: StoredKeys): StoredKeys {
  const out: StoredKeys = {};
  const a = clean(k.anthropicKey);
  const s = clean(k.assemblyAiKey);
  const o = clean(k.ownerCode);
  if (a) out.anthropicKey = a;
  if (s) out.assemblyAiKey = s;
  if (o) out.ownerCode = o;
  return out;
}

export function loadKeys(): StoredKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? tidy(JSON.parse(raw) as StoredKeys) : {};
  } catch {
    return {};
  }
}

/** Save the keys (empty fields are dropped); returns what was kept. */
export function saveKeys(keys: StoredKeys): StoredKeys {
  const kept = tidy(keys);
  try {
    if (Object.keys(kept).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / disabled storage: keys last for this visit only */
  }
  return kept;
}

/** The headers that carry this device's keys and owner code. */
export function keyHeaders(keys: StoredKeys = loadKeys()): Record<string, string> {
  const h: Record<string, string> = {};
  if (keys.anthropicKey) h[KEY_HEADERS.anthropic] = keys.anthropicKey;
  if (keys.assemblyAiKey) h[KEY_HEADERS.assemblyai] = keys.assemblyAiKey;
  if (keys.ownerCode) h[KEY_HEADERS.owner] = keys.ownerCode;
  return h;
}

/** "sk-ant-…a1b2": enough to recognize a saved key without showing it. */
export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}
