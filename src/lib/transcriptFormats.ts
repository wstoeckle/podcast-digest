// Convert whatever a <podcast:transcript> (or a pasted transcript) is in —
// WebVTT, SRT, Podcasting-2.0 JSON, generic JSON, or plain text/HTML — into
// clean plain text for the model. Pure and format-sniffing; the `type` hint
// (a MIME string) is used when present but content is the tiebreaker.
//
// toTimedTranscript() keeps the timing when the source has it, as `[m:ss]`
// paragraph markers (see timed.ts), so outline segments, quotes and cited
// answers can jump into the audio.

import { stripHtml } from './rss.js';
import { formatClock, formatTimed, type Cue } from './timed.js';

function collapse(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fromVtt(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (/^WEBVTT/i.test(l)) continue;
    if (/^NOTE\b/i.test(l)) continue;
    if (/-->/.test(l)) continue; // timestamp cue
    if (/^\d+$/.test(l)) continue; // cue index
    if (/^(STYLE|REGION)\b/i.test(l)) continue;
    // strip inline cue tags like <v Speaker> and <00:00:01.000>
    out.push(l.replace(/<[^>]+>/g, '').trim());
  }
  return collapse(out.join('\n'));
}

function fromSrt(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (/-->/.test(l)) continue;
    if (/^\d+$/.test(l)) continue;
    out.push(l);
  }
  return collapse(out.join('\n'));
}

function fromJson(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  // Podcasting 2.0: { segments: [{ speaker?, body }] }
  const segments = extractSegments(data);
  if (segments && segments.length) return collapse(segments.join('\n'));
  return null;
}

function extractSegments(data: unknown): string[] | null {
  const arr = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.segments)
      ? data.segments
      : isRecord(data) && Array.isArray(data.results)
        ? data.results
        : null;
  if (!arr) return null;
  const lines: string[] = [];
  let lastSpeaker: string | undefined;
  for (const seg of arr) {
    if (!isRecord(seg)) continue;
    const body = str(seg.body) ?? str(seg.text) ?? str(seg.transcript);
    if (!body) continue;
    const speaker = str(seg.speaker) ?? str(seg.speaker_name);
    if (speaker && speaker !== lastSpeaker) {
      lines.push(`${speaker}: ${body}`);
      lastSpeaker = speaker;
    } else {
      lines.push(body);
    }
  }
  return lines;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Best-effort conversion of a transcript payload to plain text. */
export function toPlainTranscript(raw: string, type?: string): string {
  const body = raw.trim();
  if (!body) return '';
  const t = (type ?? '').toLowerCase();

  if (t.includes('vtt') || /^WEBVTT/i.test(body)) return fromVtt(body);
  if (t.includes('srt') || t.includes('subrip')) return fromSrt(body);
  if (t.includes('json') || body.startsWith('{') || body.startsWith('[')) {
    const j = fromJson(body);
    if (j !== null) return j;
  }
  // SRT without a type hint: index line + timestamp with a comma.
  if (/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(body)) return fromSrt(body);
  if (/-->/.test(body) && /\d{2}:\d{2}/.test(body)) return fromVtt(body);
  // Sniff for HTML only when the type doesn't say plain text: a plain transcript
  // can mention "<tags>" (a page's embed code, say) without being HTML.
  if (t.includes('html') || (!t.includes('plain') && /<\/?[a-z][\s\S]*>/i.test(body))) {
    return collapse(stripHtml(body));
  }
  return collapse(body);
}

// ---- Timed transcripts ------------------------------------------------------

/**
 * Like toPlainTranscript, but keeps the timing as `[m:ss]` paragraph markers
 * when the source has it (VTT, SRT, Podcasting-2.0 JSON with start times, or
 * pasted text with timestamps). Falls back to plain text otherwise.
 */
export function toTimedTranscript(raw: string, type?: string): string {
  const cues = timedCues(raw.trim(), (type ?? '').toLowerCase());
  if (cues && cues.length >= 2) {
    const { chapters, rest } = splitChapterList(cues);
    const body = formatTimed(rest);
    if (!chapters.length) return body;
    const list = chapters.map((c) => `${c.text} (${formatClock(c.start)})`).join(' · ');
    return `Chapters: ${list}\n${body}`;
  }
  return toPlainTranscript(raw, type);
}

/**
 * Transcript pages often open with a table of contents: short titles whose
 * times run through the episode, then the transcript restarts near zero. Keep
 * that list as one plain line, so the transcript's own times stay in order.
 */
function splitChapterList(cues: Cue[]): { chapters: Cue[]; rest: Cue[] } {
  for (let i = 1; i < cues.length; i++) {
    if ((cues[i]?.start ?? 0) >= (cues[i - 1]?.start ?? 0)) continue;
    const head = cues.slice(0, i);
    const words = head.reduce((n, c) => n + (c.text.match(/\S+/g)?.length ?? 0), 0);
    if (head.length >= 2 && words / head.length <= 12 && cues.length - i >= 3) {
      return { chapters: head, rest: cues.slice(i) };
    }
    break;
  }
  return { chapters: [], rest: cues };
}

function timedCues(body: string, t: string): Cue[] | null {
  if (!body) return null;
  if (t.includes('vtt') || t.includes('srt') || t.includes('subrip') || /-->/.test(body)) {
    return cueBlocks(body);
  }
  if (t.includes('json') || body.startsWith('{') || body.startsWith('[')) {
    const fromJson = jsonCues(body);
    if (fromJson) return fromJson;
  }
  return textCues(body);
}

/** "00:01:02.500", "01:02.500", "00:01:02,500" → seconds. */
function cueTime(raw: string): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0;
  return h * 3600 + parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10) + frac;
}

/** WebVTT and SRT: blank-line separated blocks with a `start --> end` line. */
function cueBlocks(body: string): Cue[] | null {
  const cues: Cue[] = [];
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim());
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const start = cueTime((lines[timing] ?? '').split('-->')[0] ?? '');
    if (start === undefined) continue;
    let speaker: string | undefined;
    const text = lines
      .slice(timing + 1)
      .map((l) => {
        const v = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(l);
        if (v?.[1]) speaker = v[1].trim();
        return l.replace(/<[^>]+>/g, '').trim();
      })
      .filter(Boolean)
      .join(' ');
    if (text) cues.push(speaker ? { start, text, speaker } : { start, text });
  }
  return cues.length ? cues : null;
}

/** Podcasting 2.0 JSON: { segments: [{ startTime, body, speaker? }] }. */
function jsonCues(body: string): Cue[] | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const arr = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.segments)
      ? data.segments
      : null;
  if (!arr) return null;
  const cues: Cue[] = [];
  for (const seg of arr) {
    if (!isRecord(seg)) continue;
    const text = str(seg.body) ?? str(seg.text);
    const start =
      typeof seg.startTime === 'number'
        ? seg.startTime
        : typeof seg.start === 'number'
          ? seg.start
          : undefined;
    if (!text || start === undefined || !Number.isFinite(start)) continue;
    const speaker = str(seg.speaker) ?? str(seg.speaker_name);
    cues.push(speaker ? { start, text, speaker } : { start, text });
  }
  return cues.length ? cues : null;
}

const LEADING_TIME = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?[\])]?\s*(?:[-–—:|]\s*)?(.*)$/;
const SPEAKER_THEN_TIME = /^(.{1,60}?)\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*$/;
// "Lex Fridman (00:12:34) What they said…" on one line. The time must be in
// brackets, so an ordinary sentence with a time in it doesn't match.
const SPEAKER_TIME_TEXT =
  /^(.{1,60}?)\s*[[(]((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?[\])]\s*:?\s+(\S.*)$/;

/**
 * Pasted text with timestamps, in the shapes transcript sites use:
 *   "[12:34] text", "00:12:34 Speaker: text", a timestamp on its own line, or
 *   a "Speaker Name  12:34" header line followed by what they said.
 * Needs at least three timestamps in order; otherwise it isn't timed.
 */
function textCues(body: string): Cue[] | null {
  const cues: Cue[] = [];
  let cur: Cue | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lead = LEADING_TIME.exec(line);
    // A "Speaker Name  12:34" header: a short name, not a sentence ending in a time.
    const shortName = (m: RegExpExecArray | null) =>
      m && (m[1] ?? '').split(/\s+/).length <= 5 ? m : null;
    const head = lead ? null : shortName(SPEAKER_THEN_TIME.exec(line));
    const inline = lead || head ? null : shortName(SPEAKER_TIME_TEXT.exec(line));
    const time = lead
      ? clock(lead[1])
      : head
        ? clock(head[2])
        : inline
          ? clock(inline[2])
          : undefined;
    if (time !== undefined) {
      if (cur?.text) cues.push(cur);
      const who = head?.[1] ?? inline?.[1];
      const speaker = who ? who.replace(/[:\-–—]+$/, '').trim() : undefined;
      const text = lead ? (lead[2] ?? '').trim() : inline ? (inline[3] ?? '').trim() : '';
      cur = speaker ? { start: time, text, speaker } : { start: time, text };
      continue;
    }
    if (cur) cur.text = cur.text ? `${cur.text} ${line}` : line;
  }
  if (cur?.text) cues.push(cur);
  if (cues.length < 3) return null;
  // Timestamps should run forward (after any table of contents); a handful out
  // of order means they aren't times.
  const { rest } = splitChapterList(cues);
  let backwards = 0;
  for (let i = 1; i < rest.length; i++) {
    if ((rest[i]?.start ?? 0) < (rest[i - 1]?.start ?? 0)) backwards++;
  }
  return backwards > rest.length / 10 ? null : cues;
}

function clock(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parts = raw.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if ((parts[parts.length - 1] ?? 0) >= 60) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
