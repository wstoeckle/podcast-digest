// Claude helpers for the digest + Q&A endpoints and the overnight batches.
// Uses the official SDK. The live functions take the API key to spend (the
// caller's own, or the app's for its owner; see access.ts) and degrade to
// demo-mode canned content without one, so the app is fully usable (and
// testable) without a key. The overnight batches always use the app's key.

import Anthropic from '@anthropic-ai/sdk';
import type { AskEvent, ChatTurn, Digest } from '../../src/types.js';
import { stripMarkers, markers, timeAt } from '../../src/lib/timed.js';
import {
  DIGEST_SCHEMA,
  DIGEST_SYSTEM,
  askSystem,
  clampTranscript,
  DEMO_CITATION,
  demoAnswer,
  demoDigest,
  digestUserText,
  groundDigest,
  parseDigestResponse,
  type EpisodeMeta,
} from '../../src/lib/digestPrompt.js';
import type { BatchDigestResult } from './overnight.js';
import {
  ASK_MAX_TOKENS,
  DEFAULT_ASK_EFFORT,
  DEFAULT_DIGEST_EFFORT,
  DEFAULT_OVERNIGHT_MODEL,
  DIGEST_MAX_TOKENS,
  FALLBACK_BETA,
  acceptsEffort,
  acceptsFallbacks,
  resolveEffort,
  resolveModel,
  type Effort,
} from './claudeConfig.js';

const MODEL = resolveModel(process.env.DIGEST_MODEL);
const OVERNIGHT_MODEL = resolveModel(process.env.OVERNIGHT_MODEL, DEFAULT_OVERNIGHT_MODEL);
const DIGEST_EFFORT = resolveEffort(process.env.DIGEST_EFFORT, DEFAULT_DIGEST_EFFORT);
const ASK_EFFORT = resolveEffort(process.env.ASK_EFFORT, DEFAULT_ASK_EFFORT);

const DIGEST_DECLINED =
  "Claude's safety filter declined to summarize this episode, so there's no digest for it.";
const ASK_DECLINED = "Claude's safety filter declined to answer that question about this episode.";

export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(apiKey: string | undefined): Anthropic | null {
  return apiKey ? new Anthropic({ apiKey }) : null;
}

/** Whether Anthropic accepts a key, by listing models (free: no tokens spent). */
export async function checkClaudeKey(apiKey: string): Promise<'ok' | 'rejected' | 'unknown'> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 });
    return 'ok';
  } catch (err) {
    return isKeyRejected(err) ? 'rejected' : 'unknown';
  }
}

/** True when Anthropic refused the key itself (invalid, revoked, or not allowed). */
export function isKeyRejected(err: unknown): boolean {
  return (
    err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError
  );
}

/**
 * On models with safety classifiers, a declined request is re-run server-side
 * on the model Anthropic recommends for that refusal category, so a science or
 * security episode that trips a classifier still gets a digest. (The Batch API
 * doesn't take this; a declined overnight digest is simply made live later.)
 */
function fallbackParams() {
  return acceptsFallbacks(MODEL) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {};
}

function effortParams(effort: Effort, model = MODEL) {
  return acceptsEffort(model) ? { effort } : {};
}

/** The digest request, shared by the live call and the overnight batches. */
function digestParams(transcript: string, meta: EpisodeMeta, model = MODEL) {
  return {
    model,
    max_tokens: DIGEST_MAX_TOKENS,
    system: DIGEST_SYSTEM,
    // Structured outputs: the reply is guaranteed to match DIGEST_SCHEMA.
    output_config: {
      ...effortParams(DIGEST_EFFORT, model),
      format: { type: 'json_schema' as const, schema: DIGEST_SCHEMA },
    },
    messages: [{ role: 'user' as const, content: digestUserText(transcript, meta) }],
  };
}

function textOf(blocks: ReadonlyArray<{ type: string }>): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

interface UsageLike {
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

/** One structured log line per call, so cost and cache hits show up in the Vercel logs. */
function logUsage(route: 'digest' | 'ask' | 'batch', msg: UsageLike): void {
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

/** Generate a structured digest from a transcript, on `apiKey` (demo content without one). */
export async function generateDigest(
  transcript: string,
  meta: EpisodeMeta,
  apiKey: string | undefined,
): Promise<Digest> {
  const c = client(apiKey);
  if (!c) return demoDigest(meta);

  const msg = await c.beta.messages.create({
    ...digestParams(transcript, meta),
    ...fallbackParams(),
  });
  logUsage('digest', msg);

  if (msg.stop_reason === 'refusal') throw new Error(DIGEST_DECLINED);
  if (msg.stop_reason === 'max_tokens') throw new Error('the digest ran past its length limit');

  // Quotes are only shown if they appear word for word in the transcript.
  return groundDigest(parseDigestResponse(textOf(msg.content)), transcript);
}

export interface AskOptions {
  transcript: string;
  meta: EpisodeMeta;
  history: ChatTurn[];
  question: string;
  onEvent: (event: AskEvent) => void;
  /** The key to spend; a demo answer without one. */
  apiKey: string | undefined;
}

/**
 * Stream an answer grounded in the transcript. Emits text as it arrives and,
 * for each claim, the transcript passage it rests on (Citations API), with the
 * time of that passage when the transcript is timed.
 */
export async function streamAnswer(opts: AskOptions): Promise<void> {
  const { transcript, meta, history, question, onEvent } = opts;
  const c = client(opts.apiKey);

  if (!c) {
    for (const chunk of chunkText(demoAnswer(question))) {
      onEvent({ type: 'text', text: chunk });
      await sleep(20);
    }
    onEvent({ type: 'cite', ...DEMO_CITATION });
    return;
  }

  // The transcript is a citable document, prompt-cached so follow-up
  // questions in a session don't re-pay its input cost. Citation character
  // offsets point into exactly this string.
  const doc = clampTranscript(transcript);
  const docMarkers = markers(doc);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'text', media_type: 'text/plain', data: doc },
          title: meta.episodeTitle ? `Transcript of "${meta.episodeTitle}"` : 'Episode transcript',
          ...(docMarkers.length
            ? { context: 'Lines start with [m:ss] markers: the time into the episode.' }
            : {}),
          citations: { enabled: true },
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
    model: MODEL,
    ...fallbackParams(),
    output_config: effortParams(ASK_EFFORT),
    max_tokens: ASK_MAX_TOKENS,
    system: askSystem(meta),
    messages,
  });
  let wrote = false;
  stream.on('text', (delta) => {
    wrote = true;
    onEvent({ type: 'text', text: delta });
  });
  stream.on('citation', (citation) => {
    if (citation.type !== 'char_location') return;
    const text = stripMarkers(citation.cited_text).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const start = timeAt(doc, citation.start_char_index, docMarkers);
    onEvent(start !== undefined ? { type: 'cite', text, start } : { type: 'cite', text });
  });
  const final = await stream.finalMessage();
  logUsage('ask', final);

  if (final.stop_reason === 'refusal') {
    // Only reached when the fallback model declined too (or the model has none).
    onEvent({ type: 'text', text: wrote ? `\n\n[${ASK_DECLINED}]` : ASK_DECLINED });
  } else if (final.stop_reason === 'max_tokens') {
    onEvent({ type: 'text', text: '…' });
  }
}

// ---- Overnight batches (Message Batches API: half price, asynchronous) ----

function requireClient(): Anthropic {
  const c = client(process.env.ANTHROPIC_API_KEY);
  if (!c) throw new Error('ANTHROPIC_API_KEY is not set');
  return c;
}

/**
 * Submit digests for several episodes as one batch, on OVERNIGHT_MODEL;
 * returns the batch id.
 */
export async function createDigestBatch(
  items: { customId: string; transcript: string; meta: EpisodeMeta }[],
): Promise<string> {
  const batch = await requireClient().messages.batches.create({
    requests: items.map((i) => ({
      custom_id: i.customId,
      params: digestParams(i.transcript, i.meta, OVERNIGHT_MODEL),
    })),
  });
  return batch.id;
}

/** A finished batch's digests (ungrounded), or null while it is still running. */
export async function readDigestBatch(batchId: string): Promise<BatchDigestResult[] | null> {
  const c = requireClient();
  const batch = await c.messages.batches.retrieve(batchId);
  if (batch.processing_status !== 'ended') return null;
  const out: BatchDigestResult[] = [];
  for await (const r of await c.messages.batches.results(batchId)) {
    if (r.result.type !== 'succeeded') {
      out.push({ customId: r.custom_id, error: r.result.type });
      continue;
    }
    const msg = r.result.message;
    logUsage('batch', msg);
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
      out.push({ customId: r.custom_id, error: msg.stop_reason });
      continue;
    }
    try {
      out.push({ customId: r.custom_id, digest: parseDigestResponse(textOf(msg.content)) });
    } catch (err) {
      out.push({ customId: r.custom_id, error: (err as Error).message });
    }
  }
  return out;
}

function chunkText(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
