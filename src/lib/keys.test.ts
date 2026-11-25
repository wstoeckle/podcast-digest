import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_HEADERS, keyHeaders, loadKeys, maskKey, saveKeys } from './keys';

beforeEach(() => {
  localStorage.clear();
});

describe('keys', () => {
  it('saves trimmed keys on this device and drops empty ones', () => {
    expect(
      saveKeys({ anthropicKey: '  sk-ant-abc123  ', assemblyAiKey: '', ownerCode: 'code' }),
    ).toEqual({ anthropicKey: 'sk-ant-abc123', ownerCode: 'code' });
    expect(loadKeys()).toEqual({ anthropicKey: 'sk-ant-abc123', ownerCode: 'code' });
  });

  it('forgets everything when nothing is left', () => {
    saveKeys({ anthropicKey: 'sk-ant-abc123' });
    saveKeys({});
    expect(localStorage.getItem('pd.keys')).toBeNull();
    expect(loadKeys()).toEqual({});
  });

  it('turns saved keys into request headers', () => {
    expect(keyHeaders({})).toEqual({});
    expect(keyHeaders({ anthropicKey: 'a', assemblyAiKey: 'b', ownerCode: 'c' })).toEqual({
      [KEY_HEADERS.anthropic]: 'a',
      [KEY_HEADERS.assemblyai]: 'b',
      [KEY_HEADERS.owner]: 'c',
    });
  });

  it('ignores a corrupt or hand-edited entry', () => {
    localStorage.setItem('pd.keys', '{not json');
    expect(loadKeys()).toEqual({});
    localStorage.setItem('pd.keys', JSON.stringify({ anthropicKey: 'has spaces', ownerCode: 7 }));
    expect(loadKeys()).toEqual({});
  });

  it('masks a key so you can recognize it without showing it', () => {
    expect(maskKey('sk-ant-api03-abcdefghijklmnop')).toBe('sk-ant-…mnop');
    expect(maskKey('short')).toBe('••••');
  });
});
