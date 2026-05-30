import type { LanguageModel } from 'ai';

/**
 * Chat-model surface the agent runtime talks to.
 *
 * Appendix A · Phase 2.1 — a thin wrapper around the Vercel `ai` SDK's
 * `LanguageModel` that adds the metadata the runtime needs for prompt
 * budgeting and tool-calling decisions. The actual streamText/generateText
 * invocation still happens against `getLanguageModel()`, so we don't
 * re-implement provider transports here.
 *
 * Lives alongside the MVP (per the "Build Phases 2-5 alongside MVP" decision):
 * the legacy `AIProvider` interface in `src/services/ai/types.ts` is unchanged
 * and continues to power Phase 1B's TauriChatAdapter.
 */
export interface ChatModel {
  /** Stable identifier — matches the model field in AISettings. */
  readonly id: string;

  /**
   * Maximum input + output tokens the model accepts. Used by the M2.5
   * PromptContextBuilder to decide what to shrink. Hardcoded per-model in
   * registry.ts; ChatModel callers should never have to probe.
   */
  readonly contextWindow: number;

  /**
   * Tokens reserved for completion. The PromptContextBuilder budgets to
   * `contextWindow - reservedOutput - safetyMargin`. Defaults to 1024 for
   * most models; reasoning models reserve more.
   */
  readonly reservedOutput: number;

  /**
   * Whether the model supports Vercel-SDK tool calling. The runtime falls
   * back to system-prompt-injection mode when false, which matches the
   * MVP's legacy IDB path.
   */
  readonly supportsTools: boolean;

  /** Underlying Vercel SDK model; pass to streamText / generateText. */
  getLanguageModel(): LanguageModel;
}
