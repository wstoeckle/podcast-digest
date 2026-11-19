// Timed transcripts: plain text whose paragraphs start with a `[m:ss]` or
// `[h:mm:ss]` marker. Keeping the times inside the text means one string
// still flows through Redis, the browser, and the prompts unchanged; these
// helpers write the markers and read the times back out. Pure, no DOM/Node.

export interface Cue {
  /** Seconds from the start of the episode. */
  start: number;
  text: string;
  speaker?: string;
}

export interface Marker {
  /** Character offset of the line the marker starts. */
  index: number;
  /** Seconds. */
  start: number;
}

export interface TimedParagraph {
  start?: number;
  text: string;
}

const MARKER_AT_LINE_START = /^\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\] /gm;

/** 754 → "12:34", 3723 → "1:02:03". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12:34", "1:02:03", "[12:34]", "00:12:34.500" → seconds. Undefined if not a clock. */
export function parseClock(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^\s*[[(]?\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,]\d+)?\s*[\])]?\s*$/.exec(raw);
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2] ?? '0', 10);
  const sec = parseInt(m[3] ?? '0', 10);
  if (sec >= 60 || (m[1] !== undefined && min >= 60)) return undefined;
  return h * 3600 + min * 60 + sec;
}

/**
 * Render cues as timed paragraphs. A paragraph starts on a speaker change, or
 * once ~30s have passed at the end of a sentence (60s at most), so markers
 * stay frequent enough to seek with but add few tokens.
 */
export function formatTimed(cues: Cue[], paragraphSec = 30): string {
  interface Para {
    start: number;
    speaker: string | undefined;
    parts: string[];
  }
  const paras: Para[] = [];

  for (const c of cues) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(c.start)) continue;
    const cur = paras[paras.length - 1];
    const speaker = c.speaker ?? cur?.speaker;
    const elapsed = cur ? c.start - cur.start : 0;
    const endedSentence = cur
      ? /[.!?…]["')\]]*$/.test(cur.parts[cur.parts.length - 1] ?? '')
      : false;
    if (
      !cur ||
      speaker !== cur.speaker ||
      (elapsed >= paragraphSec && endedSentence) ||
      elapsed >= paragraphSec * 2
    ) {
      // Never let a paragraph start before the one above it: lookups by
      // position assume the markers run forward.
      paras.push({ start: Math.max(c.start, cur?.start ?? 0), speaker, parts: [text] });
    } else {
      cur.parts.push(text);
    }
  }

  let printedSpeaker: string | undefined;
  return paras
    .map((p) => {
      const who = p.speaker && p.speaker !== printedSpeaker ? `${p.speaker}: ` : '';
      if (p.speaker) printedSpeaker = p.speaker;
      return `[${formatClock(p.start)}] ${who}${p.parts.join(' ')}`;
    })
    .join('\n');
}

/** Every marker in the text, in order. */
export function markers(text: string): Marker[] {
  const out: Marker[] = [];
  for (const m of text.matchAll(MARKER_AT_LINE_START)) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    out.push({
      index: m.index ?? 0,
      start: h * 3600 + parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10),
    });
  }
  return out;
}

/** True when the text carries enough markers to be worth seeking with. */
export function isTimed(text: string): boolean {
  return markers(text).length >= 2;
}

/** The time of the paragraph containing `index` (the last marker at or before it). */
export function timeAt(
  text: string,
  index: number,
  all: Marker[] = markers(text),
): number | undefined {
  let lo = 0;
  let hi = all.length - 1;
  let found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = all[mid];
    if (!m) break;
    if (m.index <= index) {
      found = m.start;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The latest marker time, i.e. roughly how long the transcript runs. */
export function lastMarkerTime(text: string): number | undefined {
  const all = markers(text);
  return all.length ? Math.max(...all.map((m) => m.start)) : undefined;
}

/** The text without markers (for display or matching). */
export function stripMarkers(text: string): string {
  return text.replace(MARKER_AT_LINE_START, '');
}

/** Lines of the transcript with their times; unmarked lines inherit the previous time. */
export function timedParagraphs(text: string): TimedParagraph[] {
  const out: TimedParagraph[] = [];
  let last: number | undefined;
  for (const line of text.split('\n')) {
    const m = /^\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\] /.exec(line);
    if (m) {
      last =
        (m[1] ? parseInt(m[1], 10) : 0) * 3600 +
        parseInt(m[2] ?? '0', 10) * 60 +
        parseInt(m[3] ?? '0', 10);
    }
    const body = m ? line.slice(m[0].length) : line;
    if (!body.trim()) continue;
    out.push(last !== undefined ? { start: last, text: body } : { text: body });
  }
  return out;
}
