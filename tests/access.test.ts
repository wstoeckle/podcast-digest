import type { VercelRequest } from '@vercel/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access } from '../api/_lib/access';

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as VercelRequest;

function env(vars: {
  OWNER_CODE?: string;
  ANTHROPIC_API_KEY?: string;
  ASSEMBLYAI_API_KEY?: string;
}) {
  for (const k of ['OWNER_CODE', 'ANTHROPIC_API_KEY', 'ASSEMBLYAI_API_KEY'] as const) {
    vi.stubEnv(k, vars[k] ?? '');
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('access', () => {
  it("without an owner code, everyone uses the app's keys (a copy one person runs)", () => {
    env({ ANTHROPIC_API_KEY: 'sk-server', ASSEMBLYAI_API_KEY: 'aai-server' });
    expect(access(req())).toEqual({
      owner: true,
      claude: { use: 'server', key: 'sk-server' },
      stt: { use: 'server', key: 'aai-server' },
    });
  });

  it("keeps the app's keys for whoever has the owner code", () => {
    env({
      OWNER_CODE: 'open-sesame',
      ANTHROPIC_API_KEY: 'sk-server',
      ASSEMBLYAI_API_KEY: 'aai-server',
    });
    expect(access(req({ 'x-owner-code': 'open-sesame' }))).toMatchObject({
      owner: true,
      claude: { use: 'server', key: 'sk-server' },
    });
    for (const code of [undefined, 'wrong', 'open-sesame-plus', 'open sesame']) {
      const a = access(req(code ? { 'x-owner-code': code } : {}));
      expect(a.owner).toBe(false);
      expect(a.claude).toEqual({ use: 'locked' });
      expect(a.stt).toEqual({ use: 'locked' });
    }
  });

  it("uses the caller's own key first, owner or not", () => {
    env({ OWNER_CODE: 'open-sesame', ANTHROPIC_API_KEY: 'sk-server' });
    const a = access(req({ 'x-anthropic-key': ' sk-mine ', 'x-assemblyai-key': 'aai-mine' }));
    expect(a.claude).toEqual({ use: 'caller', key: 'sk-mine' });
    expect(a.stt).toEqual({ use: 'caller', key: 'aai-mine' });
    expect(
      access(req({ 'x-owner-code': 'open-sesame', 'x-anthropic-key': 'sk-mine' })).claude,
    ).toEqual({ use: 'caller', key: 'sk-mine' });
  });

  it('is demo mode when nobody has a key', () => {
    env({ OWNER_CODE: 'open-sesame' });
    expect(access(req())).toEqual({ owner: false, claude: { use: 'demo' }, stt: { use: 'demo' } });
  });

  it('ignores header values that are not a single token', () => {
    env({ ANTHROPIC_API_KEY: 'sk-server' });
    expect(access(req({ 'x-anthropic-key': 'two words' })).claude.use).toBe('server');
    expect(access(req({ 'x-anthropic-key': 'x'.repeat(301) })).claude.use).toBe('server');
  });
});
