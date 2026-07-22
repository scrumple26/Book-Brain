/**
 * AI spend model for the Book Brain hub — the sibling of lib/aqua.ts.
 *
 * Two deliberate differences from the Aqua meter:
 *
 * 1. The budget is UNIVERSAL — one shared pool across all accounts, not $10
 *    each — so the usage doc is global (`aiUsage/{YYYY-MM}`), not per-user.
 * 2. Aqua doses in seconds, known exactly before the call. An LLM call's cost
 *    isn't known until the response returns, because output length is the thing
 *    being generated. So spend is metered as a conservative estimate BEFORE the
 *    call and reconciled DOWN afterwards from response.usage — preserving
 *    Aqua's "may only ever overcount, never undercount" invariant.
 *
 * This module is pure math + constants; the storage side lives in lib/aiUsage.ts.
 */

export const AI_MODEL_DEFAULT = "claude-sonnet-5";
export const AI_MODEL_DEEP = "claude-opus-4-8";

/**
 * Claude Sonnet 5 LIST pricing, USD per million tokens. Deliberately NOT the
 * $2/$10 introductory rate (expires 2026-08-31) — costing the cap at the intro
 * price would silently shrink its real capacity the day that window closes.
 */
export const AI_RATE_INPUT_PER_MTOK = 3.0;
export const AI_RATE_OUTPUT_PER_MTOK = 15.0;
export const AI_RATE_CACHE_WRITE_PER_MTOK = 3.75; // 1.25x input, 5-minute TTL
export const AI_RATE_CACHE_READ_PER_MTOK = 0.3; // 0.1x input

/** Opus 4.8 list pricing, for the opt-in "deep answer" tier. */
export const AI_DEEP_RATE_INPUT_PER_MTOK = 5.0;
export const AI_DEEP_RATE_OUTPUT_PER_MTOK = 25.0;

export const AI_MONTHLY_CAP_USD = 10;
/** Stop here, not at the cap — same 90% safety margin as AQUA_HARD_STOP_USD. */
export const AI_HARD_STOP_USD = 9;

/** Output allowance charged up-front, before the real output length is known.
 *  Generous on purpose: over-charging is corrected on reconciliation, but
 *  under-charging lets a burst of calls slip past the cap mid-flight. */
export const AI_ESTIMATED_OUTPUT_TOKENS = 1000;

export function aiMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

const perMillion = (tokens: number, rate: number) => (Math.max(tokens, 0) / 1_000_000) * rate;

/** Exact cost of a completed call, priced per token class. */
export function costFromUsage(usage: TokenUsage, deep = false): number {
  const inRate = deep ? AI_DEEP_RATE_INPUT_PER_MTOK : AI_RATE_INPUT_PER_MTOK;
  const outRate = deep ? AI_DEEP_RATE_OUTPUT_PER_MTOK : AI_RATE_OUTPUT_PER_MTOK;
  return (
    perMillion(usage.inputTokens ?? 0, inRate) +
    perMillion(usage.outputTokens ?? 0, outRate) +
    perMillion(usage.cacheWriteTokens ?? 0, AI_RATE_CACHE_WRITE_PER_MTOK) +
    perMillion(usage.cacheReadTokens ?? 0, AI_RATE_CACHE_READ_PER_MTOK)
  );
}

/**
 * Worst-case cost charged before a call runs: every input token priced at the
 * cache-WRITE rate (never the cheaper read rate, even when we expect a cache
 * hit) plus the full output allowance.
 *
 * Callers MUST pass the same `maxOutputTokens` they send as `max_tokens`. That
 * is what makes the over-charge invariant hold by construction: the model
 * cannot emit more than `max_tokens`, so the estimate cannot come in under the
 * real cost no matter how long the answer runs.
 */
export function estimateCostUsd(
  inputTokens: number,
  maxOutputTokens: number = AI_ESTIMATED_OUTPUT_TOKENS,
  deep = false,
): number {
  const outRate = deep ? AI_DEEP_RATE_OUTPUT_PER_MTOK : AI_RATE_OUTPUT_PER_MTOK;
  const inRate = deep ? AI_DEEP_RATE_INPUT_PER_MTOK * 1.25 : AI_RATE_CACHE_WRITE_PER_MTOK;
  return perMillion(inputTokens, inRate) + perMillion(maxOutputTokens, outRate);
}

/** Would this call cross the hard stop? Checked before spending, never after. */
export function wouldExceedCap(spentUsd: number, estimatedUsd: number): boolean {
  return spentUsd + estimatedUsd > AI_HARD_STOP_USD;
}

/** Fraction of the monthly cap consumed, clamped to 0–1 for progress bars. */
export function aiUsageFraction(spentUsd: number): number {
  if (!(spentUsd > 0)) return 0;
  return Math.min(spentUsd / AI_MONTHLY_CAP_USD, 1);
}

/** Rough token count for arbitrary text (~4 chars/token for English prose).
 *  Good enough to size a request before paying for an exact count. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
