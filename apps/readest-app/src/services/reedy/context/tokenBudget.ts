/**
 * Cheap token-count heuristic used by PromptContextBuilder for shrink
 * decisions. Real tokenization needs the active model's tokenizer; pulling
 * one in (`tiktoken`, model-specific BPE, …) is gigabytes of byte-pair
 * tables for marginal accuracy at the prompt-budgeting layer. The
 * char-based estimate is within ~15% of true OpenAI/Anthropic counts on
 * English prose, fine for whether-to-shrink decisions.
 *
 * Replace this with a tokenizer-backed estimate if/when latency or
 * accuracy becomes the bottleneck (see Phase 2.5 follow-up).
 */

/** Characters per token for the char-based estimate. ~3.7 for English. */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inverse: rough char budget for a given token budget. Useful when a
 * layer wants to truncate text to fit a per-layer cap.
 */
export function estimateChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}
