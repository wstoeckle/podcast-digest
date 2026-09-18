// Pure prompt/schema assembly for the digest + Q&A. The actual Claude calls
// live in api/_lib/anthropic.ts; this module owns the wording, the structured
// -output schema, transcript clamping, and the demo-mode canned content — all
// unit-testable without a network or a key.

import type { Digest } from '../types.js';

export interface EpisodeMeta {
  showTitle?: string;
  episodeTitle?: string;
}

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
  },
  required: ['tldr', 'bullets', 'topics'],
} as const;

export const DIGEST_SYSTEM = [
  'You summarize podcast episodes from their transcripts for a busy reader who',
  'wants the substance without listening. Be faithful and specific: only state',
  'things the transcript actually supports — never invent facts, numbers, names,',
  'or conclusions. Prefer concrete claims and takeaways over vague description',
  '("they discuss X"). Neutral, plain, warm. No hype, no marketing tone. If the',
  'transcript is partial or unclear, summarize what is there and do not guess.',
].join(' ');

/** Rough char budget so we stay well inside context (Haiku = 200k tokens). */
export const MAX_TRANSCRIPT_CHARS = 320_000;

export function clampTranscript(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  // Keep the beginning and end — intros and conclusions carry a lot of signal.
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[…transcript truncated for length…]\n\n${text.slice(-tail)}`;
}

const JSON_INSTRUCTION = [
  'Respond with a single JSON object and nothing else — no prose, no code fence.',
  'Shape: {"tldr": string (2-4 sentences), "bullets": string[] (4-8 items, each',
  'one sentence), "topics": string[] (3-8 short tags)}.',
].join(' ');

export function digestUserText(transcript: string, meta: EpisodeMeta): string {
  const header = [
    meta.showTitle ? `Show: ${meta.showTitle}` : null,
    meta.episodeTitle ? `Episode: ${meta.episodeTitle}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    header,
    '',
    JSON_INSTRUCTION,
    '',
    '<transcript>',
    clampTranscript(transcript),
    '</transcript>',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Parse Claude's digest reply into a Digest. Tolerant of a stray code fence or
 * surrounding prose: extracts the first balanced JSON object and coerces the
 * fields. Throws only if no usable object is found.
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
  return { tldr, bullets, topics };
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
  };
}

export const DEMO_TRANSCRIPT = [
  'Host: Welcome back to the show. Today we are talking about how this podcast',
  'digest app works, end to end, without any API keys configured.',
  'Guest: Right — so in demo mode, the transcript, the digest, and the answers',
  'you get are all canned samples. The moment you add real keys, the exact same',
  'flow runs against the real episode audio and Claude.',
  'Host: And the listening piece?',
  'Guest: On-device speech synthesis, so it works offline and needs no key at all.',
].join(' ');

export function demoAnswer(question: string): string {
  return `That's a great question about "${question.slice(0, 80)}". This is a demo-mode answer: with an ANTHROPIC_API_KEY set, I'd answer this strictly from the episode's transcript, quoting what was actually said. For now, this placeholder confirms the Q&A round-trip (streaming, history, and grounding) is wired up correctly.`;
}
