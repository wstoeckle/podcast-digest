import { describe, it, expect } from 'vitest';
import {
  DEMO_TRANSCRIPT,
  DIGEST_SCHEMA,
  clampTranscript,
  digestUserText,
  demoDigest,
  askSystem,
  keepVerbatimQuotes,
  normalizeForMatch,
  parseDigestResponse,
} from './digestPrompt';

describe('DIGEST_SCHEMA', () => {
  it('requires every digest field and forbids extras', () => {
    expect(DIGEST_SCHEMA.required).toEqual(['tldr', 'bullets', 'topics', 'outline', 'quotes']);
    expect(DIGEST_SCHEMA.additionalProperties).toBe(false);
    expect(DIGEST_SCHEMA.properties.bullets.items.type).toBe('string');
  });

  it('makes outline items strict objects (structured outputs needs this)', () => {
    const item = DIGEST_SCHEMA.properties.outline.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['title', 'summary']);
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

  it('puts the transcript before the request', () => {
    const out = digestUserText('the words', {});
    expect(out.startsWith('<transcript>')).toBe(true);
    expect(out.indexOf('</transcript>')).toBeLessThan(out.indexOf('Write the digest'));
  });
});

describe('keepVerbatimQuotes', () => {
  const transcript =
    'Host: So what changed? Guest: Honestly, the batteries got cheap — and once they got cheap, everything else followed. Host: Wow.';

  it('keeps a quote that appears word for word, ignoring case and punctuation', () => {
    const q = '"The batteries got cheap, and once they got cheap, everything else followed."';
    expect(keepVerbatimQuotes([q], transcript)).toEqual([
      'The batteries got cheap, and once they got cheap, everything else followed.',
    ]);
  });

  it('drops paraphrases and invented lines', () => {
    expect(
      keepVerbatimQuotes(['Batteries became cheap and then everything followed'], transcript),
    ).toEqual([]);
  });

  it('matches whole words only', () => {
    expect(keepVerbatimQuotes(['atteries got cheap and once'], transcript)).toEqual([]);
  });

  it('drops fragments under four words and duplicates, and caps the count', () => {
    const ok = 'the batteries got cheap';
    expect(keepVerbatimQuotes(['got cheap', ok, ok.toUpperCase()], transcript)).toEqual([ok]);
    const many = Array(6)
      .fill(0)
      .map((_, i) => `word${i} a b c`);
    expect(keepVerbatimQuotes(many, many.join(' . '), 4)).toHaveLength(4);
  });

  it('normalizes accents and dashes', () => {
    expect(normalizeForMatch('Café — déjà vu!')).toBe('cafe deja vu');
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

  it('reads the outline and quotes, skipping malformed entries', () => {
    const d = parseDigestResponse(
      JSON.stringify({
        tldr: 't',
        bullets: ['a'],
        topics: [],
        outline: [{ title: ' Intro ', summary: 'Hi.' }, { summary: 'no title' }, 'x', null],
        quotes: ['a real line here', 3, ''],
      }),
    );
    expect(d.outline).toEqual([{ title: 'Intro', summary: 'Hi.' }]);
    expect(d.quotes).toEqual(['a real line here']);
  });

  it('accepts older replies without outline or quotes', () => {
    const d = parseDigestResponse('{"tldr":"t","bullets":["a"],"topics":[]}');
    expect(d.outline).toEqual([]);
    expect(d.quotes).toEqual([]);
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
    expect(d.outline?.length).toBeGreaterThan(0);
  });

  it('only quotes lines the demo transcript actually contains', () => {
    const d = demoDigest({});
    expect(keepVerbatimQuotes(d.quotes ?? [], DEMO_TRANSCRIPT)).toEqual(d.quotes);
  });
});
