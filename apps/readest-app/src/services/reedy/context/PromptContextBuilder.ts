import type { ChatModel } from '../models/ChatModel';
import { estimateTokens } from './tokenBudget';
import type { PromptLayer } from './layers/types';

export interface BuildContextArgs {
  model: ChatModel;
  layers: PromptLayer[];
  /** Reserved for the model's reply on top of `model.reservedOutput`. */
  safetyMarginTokens?: number;
}

export interface BuiltContext {
  /** Final composed system prompt. May be empty if every layer dropped out. */
  system: string;
  /** Tokens still available for the transcript (user + assistant turns). */
  historyBudget: number;
  /** Tokens consumed by the system prompt at the final shrink levels. */
  usedTokens: number;
  /** Total budget the builder targeted (context window - reservedOutput - safety). */
  totalBudget: number;
  /** Names of layers shrunk or dropped during the shrink pass, in shrink order. */
  truncated: string[];
}

const DEFAULT_SAFETY_MARGIN = 256;

/**
 * Compose the system prompt from a layered context (Phase 2.5).
 *
 * Walks the layers in `renderPriority` order to assemble the initial
 * prompt. If the result exceeds the available budget
 * (model.contextWindow - model.reservedOutput - safetyMargin), expendable
 * layers shrink one level at a time in `shrinkPriority` order until the
 * prompt fits — or every expendable layer is fully dropped.
 *
 * Returns the composed prompt + the remaining `historyBudget` the
 * AgentRuntime hands to its message-history packer (Phase 2.6).
 */
export function buildPromptContext(args: BuildContextArgs): BuiltContext {
  const safetyMargin = args.safetyMarginTokens ?? DEFAULT_SAFETY_MARGIN;
  const totalBudget = Math.max(
    0,
    args.model.contextWindow - args.model.reservedOutput - safetyMargin,
  );

  // Per-layer shrink level. 0 = full render; bumped one step at a time
  // until either the layer's shrink() returns null (dropped) or the
  // overall prompt fits the budget.
  const levels = new Map<PromptLayer, number>();
  for (const layer of args.layers) levels.set(layer, 0);

  const truncated: string[] = [];

  const compose = (): { text: string; tokens: number } => {
    const ordered = [...args.layers].sort((a, b) => a.renderPriority - b.renderPriority);
    const parts: string[] = [];
    for (const layer of ordered) {
      const level = levels.get(layer) ?? 0;
      const text = renderAtLevel(layer, level);
      if (text != null && text.length > 0) parts.push(text);
    }
    const text = parts.join('\n\n');
    return { text, tokens: estimateTokens(text) };
  };

  let { text, tokens } = compose();

  if (tokens > totalBudget) {
    // Shrink in priority order. Multiple expendable layers may need
    // multiple level-bumps; loop until either we fit or every
    // expendable layer is fully dropped.
    const shrinkOrder = args.layers
      .filter((l) => l.expendable)
      .sort((a, b) => a.shrinkPriority - b.shrinkPriority);

    let madeProgress = true;
    outer: while (tokens > totalBudget && madeProgress) {
      madeProgress = false;
      for (const layer of shrinkOrder) {
        const currentLevel = levels.get(layer) ?? 0;
        const nextLevel = currentLevel + 1;
        const probe = layer.shrink(nextLevel);
        levels.set(layer, nextLevel);
        if (!truncated.includes(layer.name)) truncated.push(layer.name);
        madeProgress = true;
        ({ text, tokens } = compose());
        // If this single bump took us under budget, stop early.
        if (tokens <= totalBudget) break outer;
        // If the probe was null AND every later level is also null, we've
        // dropped this layer; move on to the next layer in the loop.
        if (probe == null) continue;
      }
    }
  }

  const historyBudget = Math.max(0, totalBudget - tokens);
  return {
    system: text,
    historyBudget,
    usedTokens: tokens,
    totalBudget,
    truncated,
  };
}

function renderAtLevel(layer: PromptLayer, level: number): string | null {
  return level <= 0 ? layer.render() : layer.shrink(level);
}
