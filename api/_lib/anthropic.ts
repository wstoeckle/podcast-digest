// Claude helpers for the digest + Q&A endpoints. Uses the official SDK. Both
// functions degrade to demo-mode canned content when ANTHROPIC_API_KEY is
// unset, so the app is fully usable (and testable) without a key.

import Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn, Digest } from '../../src/types.js';
import {
  DIGEST_SYSTEM,
  askSystem,
  clampTranscript,
  demoAnswer,
  demoDigest,
  digestUserText,
  parseDigestResponse,
  type EpisodeMeta,
} from '../../src/lib/digestPrompt.js';

const MODEL = process.env.DIGEST_MODEL || 'claude-opus-4-8';

export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function textOf(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Generate a structured digest from a transcript. */
export async function generateDigest(transcript: string, meta: EpisodeMeta): Promise<Digest> {
  const c = client();
  if (!c) return demoDigest(meta);

  const msg = await c.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: DIGEST_SYSTEM,
    messages: [{ role: 'user', content: digestUserText(transcript, meta) }],
  });
  return parseDigestResponse(textOf(msg.content));
}

export interface AskOptions {
  transcript: string;
  meta: EpisodeMeta;
  history: ChatTurn[];
  question: string;
  onDelta: (text: string) => void;
}

/** Stream an answer grounded in the transcript, calling onDelta per chunk. */
export async function streamAnswer(opts: AskOptions): Promise<void> {
  const { transcript, meta, history, question, onDelta } = opts;
  const c = client();

  if (!c) {
    for (const chunk of chunkText(demoAnswer(question))) {
      onDelta(chunk);
      await sleep(20);
    }
    return;
  }

  // Transcript goes first as a prompt-cached block so follow-up questions in a
  // session don't re-pay its input cost.
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Episode transcript:\n<transcript>\n${clampTranscript(transcript)}\n</transcript>`,
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
    { role: 'assistant', content: 'I have the transcript. Ask your questions about the episode.' },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: question },
  ];

  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system: askSystem(meta),
    messages,
  });
  stream.on('text', (delta) => onDelta(delta));
  await stream.finalMessage();
}

function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
