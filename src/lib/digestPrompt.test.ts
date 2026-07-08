import { describe, it, expect } from 'vitest';
import {
  DIGEST_SCHEMA,
  clampTranscript,
  digestUserText,
  demoDigest,
  askSystem,
  parseDigestResponse,
} from './digestPrompt';

describe('DIGEST_SCHEMA', () => {
  it('requires the three digest fields and forbids extras', () => {
    expect(DIGEST_SCHEMA.required).toEqual(['tldr', 'bullets', 'topics']);
    expect(DIGEST_SCHEMA.additionalProperties).toBe(false);
    expect(DIGEST_SCHEMA.properties.bullets.items.type).toBe('string');
  });
});

describe('clampTranscript', () => {
  it('leaves short transcripts untouched', () => {
    expect(clampTranscript('hello', 100)).toBe('hello');
  });

  it('keeps head and tail with a marker when too long', () => {
    const text = 'A'.repeat(50) + 'B'.repeat(50);
    const out = clampTranscript(text, 40);
    expect(out).toContain('transcript truncated');
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('B')).toBe(true);
    // head (28) + tail (12) of original content retained
    expect((out.match(/A/g) ?? []).length).toBe(28);
    expect((out.match(/B/g) ?? []).length).toBe(12);
  });
});

describe('digestUserText', () => {
  it('embeds metadata and wraps the transcript in a tag', () => {
    const out = digestUserText('the words', { showTitle: 'Show', episodeTitle: 'Ep' });
    expect(out).toContain('Show: Show');
    expect(out).toContain('Episode: Ep');
    expect(out).toContain('<transcript>\nthe words\n</transcript>');
  });
});

describe('askSystem', () => {
  it('names the episode and forbids going beyond the transcript', () => {
    const s = askSystem({ episodeTitle: 'Deep Dive' });
    expect(s).toContain('Deep Dive');
    expect(s.toLowerCase()).toContain('only from the transcript');
  });
});

describe('parseDigestResponse', () => {
  it('parses a clean JSON object', () => {
    const d = parseDigestResponse('{"tldr":"t","bullets":["a","b"],"topics":["x"]}');
    expect(d.tldr).toBe('t');
    expect(d.bullets).toEqual(['a', 'b']);
    expect(d.topics).toEqual(['x']);
  });

  it('tolerates a code fence and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"tldr":"t","bullets":["a"],"topics":[]}\n```\nDone.';
    expect(parseDigestResponse(raw).tldr).toBe('t');
  });

  it('handles braces inside string values', () => {
    const d = parseDigestResponse('{"tldr":"uses {curly} braces","bullets":["a"],"topics":[]}');
    expect(d.tldr).toBe('uses {curly} braces');
  });

  it('drops non-string bullet entries', () => {
    const d = parseDigestResponse('{"tldr":"t","bullets":["a",5,null,"b"],"topics":["x"]}');
    expect(d.bullets).toEqual(['a', 'b']);
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseDigestResponse('no json here')).toThrow();
  });

  it('throws when the object has no usable content', () => {
    expect(() => parseDigestResponse('{"tldr":"","bullets":[]}')).toThrow();
  });
});

describe('demoDigest', () => {
  it('is flagged as demo and well-formed', () => {
    const d = demoDigest({ episodeTitle: 'X' });
    expect(d.demo).toBe(true);
    expect(d.bullets.length).toBeGreaterThanOrEqual(4);
    expect(d.topics.length).toBeGreaterThan(0);
    expect(d.tldr).toContain('X');
  });
});
