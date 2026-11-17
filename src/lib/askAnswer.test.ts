import { describe, expect, it } from 'vitest';
import type { AskEvent } from '../types';
import { applyAskEvent, type AnswerTurn } from './askAnswer';

function build(events: AskEvent[]): AnswerTurn {
  return events.reduce(applyAskEvent, { role: 'assistant', content: '' } as AnswerTurn);
}

describe('applyAskEvent', () => {
  it('joins text and places a numbered marker where each citation arrives', () => {
    const t = build([
      { type: 'text', text: 'Batteries ' },
      { type: 'text', text: 'got cheap.' },
      { type: 'cite', text: 'The batteries got cheap.', start: 65 },
      { type: 'text', text: ' Then storage spread.' },
      { type: 'cite', text: 'Storage followed.' },
    ]);
    expect(t.content).toBe('Batteries got cheap. Then storage spread.');
    expect(t.parts).toEqual([
      { text: 'Batteries got cheap.' },
      { cite: 1 },
      { text: ' Then storage spread.' },
      { cite: 2 },
    ]);
    expect(t.cites).toEqual([
      { text: 'The batteries got cheap.', start: 65 },
      { text: 'Storage followed.' },
    ]);
  });

  it('reuses the number for a passage cited again, and skips back-to-back repeats', () => {
    const t = build([
      { type: 'text', text: 'A.' },
      { type: 'cite', text: 'x' },
      { type: 'cite', text: 'x' },
      { type: 'text', text: ' B.' },
      { type: 'cite', text: 'x' },
    ]);
    expect(t.parts).toEqual([{ text: 'A.' }, { cite: 1 }, { text: ' B.' }, { cite: 1 }]);
    expect(t.cites).toHaveLength(1);
  });

  it('ignores error events (the chat shows those separately)', () => {
    expect(build([{ type: 'error', message: 'boom' }]).content).toBe('');
  });
});
