// Pure model / effort settings for the Claude calls. No SDK import, so the
// rules are unit-testable without a network or a key.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Claude Opus 5.5: $4 / $20 per million tokens (Opus 4.8 was $5 / $25), cache
 * reads at $0.20, and better at long analytical reading. Override with
 * DIGEST_MODEL (e.g. `claude-haiku-5-5` for the cheapest runs).
 */
export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Overnight digests are made for episodes you may never open, so they default
 * to Claude Haiku 5.5: $0.10 / $0.50 per million tokens, halved again by the
 * Batch API — a fraction of a cent per episode. Override with OVERNIGHT_MODEL.
 */
export const DEFAULT_OVERNIGHT_MODEL = 'claude-haiku-5-5';

/**
 * Effort replaces thinking budgets on current models and is the main
 * cost/latency dial. The digest is careful reading of a long transcript;
 * follow-up answers are short chat, where `low` keeps time-to-first-token down.
 */
export const DEFAULT_DIGEST_EFFORT: Effort = 'medium';
export const DEFAULT_ASK_EFFORT: Effort = 'low';

/** Thinking counts toward max_tokens, so leave room for it as well as the reply. */
export const DIGEST_MAX_TOKENS = 16_000;
export const ASK_MAX_TOKENS = 8_000;

/** Server-side refusal fallbacks (beta): a declined request is retried on another model. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function resolveModel(raw: string | undefined, fallback = DEFAULT_MODEL): string {
  return raw?.trim() || fallback;
}

export function resolveEffort(raw: string | undefined, fallback: Effort): Effort {
  const v = raw?.trim().toLowerCase();
  return EFFORTS.find((e) => e === v) ?? fallback;
}

/** Claude 3.x, Haiku 4.5 and Sonnet 4.5 reject `output_config.effort`. */
export function acceptsEffort(model: string): boolean {
  return !/^claude-(3|haiku-4|sonnet-4-5)/.test(model);
}

/**
 * Models whose safety classifiers can decline a request and that support
 * `fallbacks: "default"`: Opus 5 / 5.5, Sonnet 5.5, and Fable 5.x. Haiku 5.5
 * has no server-side fallback, and older models don't take the parameter.
 */
export function acceptsFallbacks(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}
