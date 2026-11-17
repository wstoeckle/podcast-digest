// Building an answer from the /api/ask event stream: text with citation
// markers interleaved, plus the transcript passages they point to. Pure.

import type { AskEvent, ChatTurn, Citation } from '../types';

export type AnswerPart = { text: string } | { cite: number };

/** A chat turn as shown: answers carry citation markers and their passages. */
export interface AnswerTurn extends ChatTurn {
  parts?: AnswerPart[];
  cites?: Citation[];
}

/** Fold one stream event into the answer being built. */
export function applyAskEvent(turn: AnswerTurn, event: AskEvent): AnswerTurn {
  const parts = turn.parts ?? [];
  const cites = turn.cites ?? [];
  if (event.type === 'text') {
    const last = parts[parts.length - 1];
    const nextParts =
      last && 'text' in last
        ? [...parts.slice(0, -1), { text: last.text + event.text }]
        : [...parts, { text: event.text }];
    return { ...turn, content: turn.content + event.text, parts: nextParts };
  }
  if (event.type === 'cite') {
    let index = cites.findIndex((c) => c.text === event.text);
    const nextCites = index >= 0 ? cites : [...cites, citationOf(event)];
    if (index < 0) index = nextCites.length - 1;
    const n = index + 1;
    // The same passage cited twice in a row gets one marker.
    const last = parts[parts.length - 1];
    if (last && 'cite' in last && last.cite === n) return { ...turn, cites: nextCites };
    return { ...turn, parts: [...parts, { cite: n }], cites: nextCites };
  }
  return turn;
}

function citationOf(e: Citation): Citation {
  return e.start !== undefined ? { text: e.text, start: e.start } : { text: e.text };
}
