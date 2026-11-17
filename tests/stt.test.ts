import { describe, expect, it } from 'vitest';
import { assemblyAiText } from '../api/_lib/stt';

const w = (text: string, start: number) => ({ text, start });

describe('assemblyAiText', () => {
  it('turns speaker turns into timed, labelled paragraphs', () => {
    const text = assemblyAiText({
      status: 'completed',
      text: 'flat text',
      utterances: [
        {
          speaker: 'A',
          start: 0,
          words: [w('Welcome', 0), w('back.', 400), w('Today', 1000), w('batteries.', 1500)],
        },
        {
          speaker: 'B',
          start: 62_000,
          words: [w('They', 62_000), w('got', 62_300), w('cheap.', 62_600)],
        },
      ],
    });
    expect(text).toBe(
      '[0:00] Speaker A: Welcome back. Today batteries.\n[1:02] Speaker B: They got cheap.',
    );
  });

  it('uses word timings when there are no speaker turns', () => {
    const text = assemblyAiText({
      status: 'completed',
      words: [w('One.', 0), w('Two.', 45_000)],
    });
    expect(text).toBe('[0:00] One.\n[0:45] Two.');
  });

  it('falls back to the flat text', () => {
    expect(assemblyAiText({ status: 'completed', text: 'just text' })).toBe('just text');
    expect(assemblyAiText({ status: 'completed' })).toBeUndefined();
  });
});
