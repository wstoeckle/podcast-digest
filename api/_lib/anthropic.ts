// Claude helpers for the digest + Q&A endpoints. Uses the official SDK. Both
// functions degrade to demo-mode canned content when ANTHROPIC_API_KEY is
// unset, so the app is fully usable (and testable) without a key.

import Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn, Digest } from '../../src/types.js';
import {
  DIGEST_SCHEMA,
  DIGEST_SYSTEM,
  askSystem,
  clampTranscript,
  demoAnswer,
  demoDigest,
  digestUserText,
  keepVerbatimQuotes,
  parseDigestResponse,
  type EpisodeMeta,
} from '../../src/lib/digestPrompt.js';
import {
  ASK_MAX_TOKENS,
  DEFAULT_ASK_EFFORT,
  DEFAULT_DIGEST_EFFORT,
  DIGEST_MAX_TOKENS,
  FALLBACK_BETA,
  acceptsEffort,
  acceptsFallbacks,
  resolveEffort,
  resolveModel,
  type Effort,
} from './claudeConfig.js';

const MODEL = resolveModel(process.env.DIGEST_MODEL);
const DIGEST_EFFORT = resolveEffort(process.env.DIGEST_EFFORT, DEFAULT_DIGEST_EFFORT);
const ASK_EFFORT = resolveEffort(process.env.ASK_EFFORT, DEFAULT_ASK_EFFORT);

const DIGEST_DECLINED =
  "Claude's safety filter declined to summarize this episode, so there's no digest for it.";
const ASK_DECLINED = "Claude's safety filter declined to answer that question about this episode.";

export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Request fields both routes share. On models with safety classifiers, a
 * declined request is re-run server-side on the model Anthropic recommends for
 * that refusal category (`fallbacks: "default"`), so a science or security
 * episode that trips a classifier still gets a digest.
 */
function shared(effort: Effort) {
  return {
    model: MODEL,
    ...(acceptsFallbacks(MODEL) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    output_config: acceptsEffort(MODEL) ? { effort } : {},
  };
}

function textOf(blocks: Anthropic.Beta.BetaContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** One structured log line per call, so cost and cache hits show up in the Vercel logs. */
function logUsage(route: 'digest' | 'ask', msg: Anthropic.Beta.BetaMessage): void {
  const u = msg.usage;
  console.log(
    JSON.stringify({
      event: 'claude_usage',
      route,
      model: msg.model,
      stop: msg.stop_reason,
      input: u.input_tokens,
      output: u.output_tokens,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
    }),
  );
}

/** Generate a structured digest from a transcript. */
export async function generateDigest(transcript: string, meta: EpisodeMeta): Promise<Digest> {
  const c = client();
  if (!c) return demoDigest(meta);

  const base = shared(DIGEST_EFFORT);
  const msg = await c.beta.messages.create({
    ...base,
    max_tokens: DIGEST_MAX_TOKENS,
    system: DIGEST_SYSTEM,
    // Structured outputs: the reply is guaranteed to match DIGEST_SCHEMA.
    output_config: {
      ...base.output_config,
      format: { type: 'json_schema', schema: DIGEST_SCHEMA },
    },
    messages: [{ role: 'user', content: digestUserText(transcript, meta) }],
  });
  logUsage('digest', msg);

  if (msg.stop_reason === 'refusal') throw new Error(DIGEST_DECLINED);
  if (msg.stop_reason === 'max_tokens') throw new Error('the digest ran past its length limit');

  const digest = parseDigestResponse(textOf(msg.content));
  // Quotes are only shown if they appear word for word in the transcript.
  return { ...digest, quotes: keepVerbatimQuotes(digest.quotes ?? [], transcript) };
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
  const messages: Anthropic.Beta.BetaMessageParam[] = [
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
    ...history.map((t): Anthropic.Beta.BetaMessageParam =>
      t.role === 'user'
        ? { role: 'user', content: t.content }
        : { role: 'assistant', content: t.content },
    ),
    { role: 'user', content: question },
  ];

  const stream = c.beta.messages.stream({
    ...shared(ASK_EFFORT),
    max_tokens: ASK_MAX_TOKENS,
    system: askSystem(meta),
    messages,
  });
  let wrote = false;
  stream.on('text', (delta) => {
    wrote = true;
    onDelta(delta);
  });
  const final = await stream.finalMessage();
  logUsage('ask', final);

  if (final.stop_reason === 'refusal') {
    // Only reached when the fallback model declined too (or the model has none).
    onDelta(wrote ? `\n\n[${ASK_DECLINED}]` : ASK_DECLINED);
  } else if (final.stop_reason === 'max_tokens') {
    onDelta('…');
  }
}

function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
