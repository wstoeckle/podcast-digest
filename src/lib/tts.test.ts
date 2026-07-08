import { describe, it, expect } from 'vitest';
import { splitSentences } from './tts';

describe('splitSentences', () => {
  it('splits on sentence terminators and keeps them', () => {
    expect(splitSentences('Hello world. How are you? Fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'Fine!',
    ]);
  });

  it('handles a trailing fragment with no terminator', () => {
    expect(splitSentences('First. Second')).toEqual(['First.', 'Second']);
  });

  it('breaks very long sentences at clause boundaries', () => {
    const long = 'a'.repeat(200) + ', ' + 'b'.repeat(100) + '.';
    const out = splitSentences(long);
    expect(out.length).toBe(2);
    expect(out[0]?.endsWith(',')).toBe(true);
  });

  it('returns empty for blank input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});
