// Pure prompt/schema assembly for the digest + Q&A. The actual Claude calls
// live in api/_lib/anthropic.ts; this module owns the wording, the structured
// -output schema, transcript clamping, and the demo-mode canned content — all
// unit-testable without a network or a key.

import type { Digest, OutlineItem, Quote } from '../types.js';
import { lastMarkerTime, parseClock, timedParagraphs } from './timed.js';

export interface EpisodeMeta {
  showTitle?: string;
  episodeTitle?: string;
}

/**
 * Version of the digest prompt + schema. Cached digests are keyed by it
 * (`d:<version>:<guid>`), so bump it whenever either changes.
 */
export const PROMPT_VERSION = 'v3';

/** JSON Schema for the structured digest (output_config.format). */
export const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tldr: {
      type: 'string',
      description: 'A 2-4 sentence plain-language summary of the whole episode.',
    },
    bullets: {
      type: 'array',
      description: 'The 4-8 most important points, claims, or takeaways, each one sentence.',
      items: { type: 'string' },
    },
    topics: {
      type: 'array',
      description: '3-8 short topic tags (1-3 words each).',
      items: { type: 'string' },
    },
    outline: {
      type: 'array',
      description: "The episode's main segments in the order they happen, 3-10 entries.",
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'A short segment title, 2-6 words.' },
          summary: { type: 'string', description: 'One sentence on what the segment covers.' },
          start: {
            type: 'string',
            description:
              'Where the segment begins: the [m:ss] or [h:mm:ss] time marker of the transcript paragraph it starts in, without brackets (e.g. "12:34"). Empty string if the transcript has no time markers.',
          },
        },
        required: ['title', 'summary', 'start'],
      },
    },
    quotes: {
      type: 'array',
      description:
        'Up to 4 short, telling lines copied word for word from the transcript (under 40 words each). Never paraphrase: return fewer quotes rather than an inexact one.',
      items: { type: 'string' },
    },
  },
  required: ['tldr', 'bullets', 'topics', 'outline', 'quotes'],
} as const;

export const DIGEST_SYSTEM = [
  'You summarize podcast episodes from their transcripts for a busy reader who',
  'wants the substance without listening. Be faithful and specific: only state',
  'things the transcript actually supports — never invent facts, numbers, names,',
  'or conclusions. Prefer concrete claims and takeaways over vague description',
  '("they discuss X"). Neutral, plain, warm. No hype, no marketing tone. If the',
  'transcript is partial or unclear, summarize what is there and do not guess.',
].join(' ');

/**
 * Rough char budget (~80k tokens, 6+ hours of speech). Current models take 1M
 * tokens, but staying under 100k keeps Claude Haiku 5.5 on its cheaper rate
 * card and bounds the cost of any one request.
 */
export const MAX_TRANSCRIPT_CHARS = 320_000;

export function clampTranscript(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  // Keep the beginning and end — intros and conclusions carry a lot of signal.
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[…transcript truncated for length…]\n\n${text.slice(-tail)}`;
}

// The reply's shape is enforced by structured outputs (DIGEST_SCHEMA); this
// says what each part is for.
const DIGEST_INSTRUCTION = [
  'Write the digest of this episode: a 2-4 sentence TLDR; the 4-8 most important',
  'points, one sentence each; 3-8 short topic tags; an outline of the main',
  'segments in the order they happen; and up to 4 short lines quoted word for',
  'word from the transcript that capture what was said. If the transcript has',
  '[m:ss] time markers, give each outline segment the marker of the paragraph',
  'where it begins.',
].join(' ');

/** The transcript comes first and the request last, which suits long inputs. */
export function digestUserText(transcript: string, meta: EpisodeMeta): string {
  const header = [
    meta.showTitle ? `Show: ${meta.showTitle}` : null,
    meta.episodeTitle ? `Episode: ${meta.episodeTitle}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    header || null,
    header ? '' : null,
    '<transcript>',
    clampTranscript(transcript),
    '</transcript>',
    '',
    DIGEST_INSTRUCTION,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Keep only quotes that appear word for word in the transcript (ignoring case,
 * punctuation and time markers), so the digest never shows a line nobody said,
 * and attach the time of the paragraph each one starts in. Drops duplicates
 * and fragments under four words.
 */
export function groundQuotes(quotes: string[], transcript: string, max = 4): Quote[] {
  // One normalized haystack, remembering where each paragraph starts in it.
  let haystack = ' ';
  const starts: { pos: number; start?: number }[] = [];
  for (const p of timedParagraphs(transcript)) {
    const n = normalizeForMatch(p.text);
    if (!n) continue;
    starts.push(p.start !== undefined ? { pos: haystack.length, start: p.start } : { pos: haystack.length });
    haystack += `${n} `;
  }
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const raw of quotes) {
    const text = raw.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
    const needle = normalizeForMatch(text);
    if (needle.split(' ').length < 4 || seen.has(needle)) continue;
    const at = haystack.indexOf(` ${needle} `);
    if (at < 0) continue;
    seen.add(needle);
    let start: number | undefined;
    for (const p of starts) {
      if (p.pos > at + 1) break;
      start = p.start;
    }
    out.push(start !== undefined ? { text, start } : { text });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Check a parsed digest against its transcript: quotes must appear verbatim
 * (and get their times), and outline times must fall inside the transcript.
 */
export function groundDigest(digest: Digest, transcript: string): Digest {
  const last = lastMarkerTime(transcript);
  const outline = (digest.outline ?? []).map((item) => {
    if (item.start === undefined) return item;
    if (last !== undefined && item.start <= last + 60) return item;
    return { title: item.title, summary: item.summary };
  });
  const quotes = groundQuotes((digest.quotes ?? []).map((q) => q.text), transcript);
  return { ...digest, outline, quotes };
}

/**
 * Parse Claude's digest reply into a Digest. Structured outputs make the reply
 * clean JSON, but this stays tolerant of a stray code fence or surrounding
 * prose: extracts the first balanced JSON object and coerces the fields.
 * Throws only if no usable object is found.
 */
export function parseDigestResponse(text: string): Digest {
  const json = extractJsonObject(text);
  if (!json) throw new Error('no JSON object in model response');
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('digest response was not valid JSON');
  }
  if (typeof obj !== 'object' || obj === null) throw new Error('digest response was not an object');
  const rec = obj as Record<string, unknown>;
  const tldr = typeof rec.tldr === 'string' ? rec.tldr.trim() : '';
  const bullets = Array.isArray(rec.bullets)
    ? rec.bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    : [];
  const topics = Array.isArray(rec.topics)
    ? rec.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  if (!tldr && bullets.length === 0) throw new Error('digest response had no content');
  const outline = Array.isArray(rec.outline) ? rec.outline.flatMap(toOutlineItem) : [];
  const quotes: Quote[] = Array.isArray(rec.quotes)
    ? rec.quotes.flatMap((q) => (typeof q === 'string' && q.trim() ? [{ text: q.trim() }] : []))
    : [];
  return { tldr, bullets, topics, outline, quotes };
}

function toOutlineItem(v: unknown): OutlineItem[] {
  if (typeof v !== 'object' || v === null) return [];
  const { title, summary, start } = v as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim()) return [];
  const item: OutlineItem = {
    title: title.trim(),
    summary: typeof summary === 'string' ? summary.trim() : '',
  };
  const at = typeof start === 'string' ? parseClock(start) : undefined;
  return [at !== undefined ? { ...item, start: at } : item];
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function askSystem(meta: EpisodeMeta): string {
  const who = meta.episodeTitle ? ` of "${meta.episodeTitle}"` : '';
  return [
    `You are answering follow-up questions about a specific podcast episode${who},`,
    'using its transcript (provided in the conversation) as your only source.',
    'Answer only from the transcript. If the transcript does not address the',
    "question, say so plainly rather than guessing. Quote or paraphrase what was",
    'actually said. Keep answers tight and readable — a few sentences unless the',
    'question genuinely needs more.',
  ].join(' ');
}

// ---- Demo mode (no ANTHROPIC_API_KEY) -------------------------------------

export function demoDigest(meta: EpisodeMeta): Digest {
  const title = meta.episodeTitle ?? 'this episode';
  return {
    demo: true,
    tldr: `This is a sample digest for "${title}". Add an ANTHROPIC_API_KEY (and, for episodes without a published transcript, an ASSEMBLYAI_API_KEY) to generate a real TLDR, key points, and topics from the actual transcript. Everything else in the app is fully wired — this placeholder simply stands in for Claude's output.`,
    bullets: [
      'The digest condenses a full episode into a 2–4 sentence TLDR plus the handful of points that actually matter.',
      'Key points are drawn strictly from the transcript — the model is instructed never to invent claims.',
      'You can ask follow-up questions in the chat below; answers stream in and are grounded in the same transcript.',
      'Press Listen to have the digest read aloud on-device — no extra service or key required.',
      'Save an episode to your library (the heart) to keep its digest for later; it lives only on this device.',
    ],
    topics: ['demo mode', 'setup', 'how it works'],
    outline: [
      {
        title: 'How the app works',
        summary: 'The host sets up an end-to-end walkthrough with no API keys configured.',
        start: 0,
      },
      {
        title: 'What demo mode does',
        summary:
          'The guest explains that transcript, digest, and answers are canned samples until real keys are added.',
        start: 12,
      },
      {
        title: 'Listening offline',
        summary: 'Read-aloud uses on-device speech synthesis, so it works offline with no key.',
        start: 41,
      },
    ],
    quotes: [
      {
        text: 'The moment you add real keys, the exact same flow runs against the real episode audio and Claude.',
        start: 12,
      },
      { text: 'On-device speech synthesis, so it works offline and needs no key at all.', start: 41 },
    ],
  };
}

export const DEMO_TRANSCRIPT = [
  '[0:00] Host: Welcome back to the show. Today we are talking about how this podcast digest app works, end to end, without any API keys configured.',
  '[0:12] Guest: Right — so in demo mode, the transcript, the digest, and the answers you get are all canned samples. The moment you add real keys, the exact same flow runs against the real episode audio and Claude.',
  '[0:38] Host: And the listening piece?',
  '[0:41] Guest: On-device speech synthesis, so it works offline and needs no key at all.',
].join('\n');

/** The passage the demo answer cites, so the citation UI shows without a key. */
export const DEMO_CITATION = {
  text: 'The moment you add real keys, the exact same flow runs against the real episode audio and Claude.',
  start: 12,
} as const;

export function demoAnswer(question: string): string {
  return `That's a great question about "${question.slice(0, 80)}". This is a demo-mode answer: with an ANTHROPIC_API_KEY set, I'd answer this strictly from the episode's transcript, quoting what was actually said. For now, this placeholder confirms the Q&A round-trip (streaming, history, and grounding) is wired up correctly.`;
}
