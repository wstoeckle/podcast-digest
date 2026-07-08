// Convert whatever a <podcast:transcript> (or a pasted transcript) is in —
// WebVTT, SRT, Podcasting-2.0 JSON, generic JSON, or plain text/HTML — into
// clean plain text for the model. Pure and format-sniffing; the `type` hint
// (a MIME string) is used when present but content is the tiebreaker.

import { stripHtml } from './rss.js';

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
  if (t.includes('html') || /<\/?[a-z][\s\S]*>/i.test(body)) return collapse(stripHtml(body));
  return collapse(body);
}
