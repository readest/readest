import { tool } from 'ai';
import { z } from 'zod';
import type { BookRetriever, RetrieverStatus } from '../retrieval/BookRetriever';
import type { EmbeddingModel } from '../models/EmbeddingModel';

/**
 * Statuses the tool may return to the model. Mirrors RetrieverStatus from
 * BookRetriever plus the tool-only `budget_exceeded` flag that fires when
 * the assistant turn has already spent its per-turn retrieval wall-clock.
 */
export type LookupToolStatus = RetrieverStatus | 'budget_exceeded';

export interface LookupPassage {
  cfi: string;
  endCfi: string;
  chapter?: string;
  text: string;
}

export interface LookupToolResult {
  passages: LookupPassage[];
  status: LookupToolStatus;
  /** True when the result came from this turn's dedupe cache. */
  cached?: boolean;
  /** True when result-size clamping dropped passages to stay under 6000 chars. */
  truncated?: boolean;
  /** Human-readable next-step hint for non-`ok` statuses. */
  hint?: string;
}

/**
 * Per-turn state shared across every lookupPassage invocation in one assistant
 * turn. Holds (a) the dedupe cache keyed on the composite request shape, and
 * (b) the parallel-call serialization chain so concurrent tool dispatches
 * mutate `totalToolMs` and `cache` in a consistent order.
 */
export interface LookupTurnState {
  totalToolMs: number;
  cache: Map<string, LookupToolResult>;
  pendingChain: Promise<void>;
}

export function createTurnState(): LookupTurnState {
  return { totalToolMs: 0, cache: new Map(), pendingChain: Promise.resolve() };
}

const MAX_QUERY_CHARS = 500;
const MAX_TOP_K = 5;
const PER_TURN_BUDGET_MS = 10_000;
const RESULT_SIZE_CAP_CHARS = 6_000;

/**
 * Exported so tests and prospective callers can pre-validate input without
 * going through the Tool wrapper (the Tool's `inputSchema` becomes a
 * provider-utils FlexibleSchema with no `.safeParse`).
 */
export const lookupInputSchema = z.object({
  query: z.string().min(1).max(MAX_QUERY_CHARS),
  topK: z.number().int().min(1).max(MAX_TOP_K).default(MAX_TOP_K),
});

export interface BuildLookupToolArgs {
  bookHash: string;
  retriever: BookRetriever;
  activeEmbeddingModel: EmbeddingModel;
  turnState: LookupTurnState;
  /** Optional position cap for spoiler-free retrieval. */
  spoilerBoundPosition?: number;
  /**
   * Optional sink for telemetry — wired by M1.9 to record `tool_called`,
   * `tool_returned_empty`, etc. Kept as a callback so the tool factory has
   * no direct dependency on the metrics module.
   */
  onEvent?: (event: { type: string; payload?: Record<string, unknown> }) => void;
}

/**
 * Construct the Vercel `ai`-SDK Tool factory used by ReedyBackend (M1.7).
 *
 * Behaviour mandated by plan §M1.6:
 *   - Zod-validated input (`{ query, topK }`).
 *   - Per-turn dedupe via a composite key over query + topK + spoiler +
 *     active model id.
 *   - Parallel-call serialization so concurrent tool dispatches mutate
 *     shared state in order.
 *   - 10s per-turn wall-clock budget; over-budget calls short-circuit with
 *     `status: 'budget_exceeded'` so the model finalizes its answer.
 *   - Result-size clamp at 6000 chars; lowest-ranked passages drop first.
 *   - Status passthrough (`not_indexed`, `empty_index`, `stale_index`,
 *     `degraded`) with human-readable hints the model can repeat verbatim.
 *
 * Trust markers (XML envelope + escape) are produced by `serializeForModel`,
 * not the tool itself — the tool returns the structured result; the M1.7
 * prompt builder wraps each passage at the system-message boundary.
 */
export function buildLookupTool(args: BuildLookupToolArgs) {
  const { bookHash, retriever, activeEmbeddingModel, turnState, spoilerBoundPosition, onEvent } =
    args;

  return tool({
    description:
      "Look up passages from the user's currently open book by semantic + lexical search. " +
      'Returns up to topK passages with CFI anchors the UI uses to navigate. ' +
      'Call this whenever the user asks about the book content. ' +
      "If status != 'ok', use the hint to phrase the user-visible reply.",
    inputSchema: lookupInputSchema,
    async execute({ query, topK }) {
      // Chain on the prior call so concurrent dispatches serialize.
      const chained = turnState.pendingChain.then(
        () => doExecute({ query, topK }),
        () => doExecute({ query, topK }),
      );
      turnState.pendingChain = chained.then(
        () => undefined,
        () => undefined,
      );
      return chained;
    },
  });

  async function doExecute({
    query,
    topK,
  }: {
    query: string;
    topK: number;
  }): Promise<LookupToolResult> {
    const cacheKey = JSON.stringify({
      q: query.trim().toLowerCase(),
      k: topK,
      sb: spoilerBoundPosition ?? null,
      m: activeEmbeddingModel.id,
      b: bookHash,
    });
    const cached = turnState.cache.get(cacheKey);
    if (cached) {
      onEvent?.({ type: 'tool_call_cached', payload: { query_length: query.length } });
      return { ...cached, cached: true };
    }

    if (turnState.totalToolMs > PER_TURN_BUDGET_MS) {
      const result: LookupToolResult = {
        passages: [],
        status: 'budget_exceeded',
        hint: 'Per-turn retrieval budget exhausted; do not call lookupPassage again this turn — finalize the answer with what you already have.',
      };
      onEvent?.({ type: 'budget_exceeded' });
      // Don't cache budget_exceeded — caller might want to retry next turn.
      return result;
    }

    onEvent?.({
      type: 'tool_called',
      payload: { tool: 'lookupPassage', query_length: query.length },
    });
    const t0 = Date.now();
    const retrieved = await retriever.search({
      bookHash,
      query,
      k: topK,
      spoilerBoundPosition,
      activeEmbeddingModel,
    });
    turnState.totalToolMs += Date.now() - t0;

    const passages: LookupPassage[] = retrieved.passages.map((p) => ({
      cfi: p.cfi,
      endCfi: p.endCfi,
      chapter: p.chapterTitle ?? undefined,
      text: p.text,
    }));

    const { clamped, truncated } = clampToCharCap(passages, RESULT_SIZE_CAP_CHARS);

    if (clamped.length === 0 && retrieved.status === 'ok') {
      onEvent?.({ type: 'tool_returned_empty' });
    }
    if (retrieved.status === 'stale_index') {
      onEvent?.({ type: 'tool_returned_stale' });
    }

    const result: LookupToolResult = {
      passages: clamped,
      status: retrieved.status,
      truncated: truncated || undefined,
      hint: retrieved.status === 'ok' ? undefined : hintFor(retrieved.status, retrieved.reason),
    };
    turnState.cache.set(cacheKey, result);
    return result;
  }
}

function clampToCharCap(
  passages: LookupPassage[],
  cap: number,
): { clamped: LookupPassage[]; truncated: boolean } {
  let total = 0;
  for (const p of passages) total += p.text.length;
  if (total <= cap) return { clamped: passages, truncated: false };
  // Drop from the end (lowest RRF rank) until under cap.
  const clamped = [...passages];
  while (clamped.length > 0 && total > cap) {
    const dropped = clamped.pop()!;
    total -= dropped.text.length;
  }
  return { clamped, truncated: true };
}

function hintFor(status: LookupToolStatus, reason?: string): string {
  switch (status) {
    case 'not_indexed':
      return "This book hasn't been indexed yet. Tell the user to open AI settings and click 'Index this book'.";
    case 'empty_index':
      return 'This book contains no extractable text (image-only PDF or scanned book). Tell the user Reedy cannot answer questions about its content.';
    case 'stale_index':
      return reason
        ? `${reason}. Tell the user to re-index the book from settings.`
        : 'The active embedding model differs from the one this book was indexed with. Tell the user to re-index.';
    case 'degraded':
      return reason
        ? `Vector search unavailable (${reason}). Answer with what you got and mention that results are text-match only.`
        : 'Vector search was temporarily unavailable; results are from text matching only.';
    case 'budget_exceeded':
      return 'Per-turn retrieval budget exhausted; finalize the answer with what you already have.';
    case 'ok':
      return '';
  }
}

/**
 * Wrap a passage for inclusion in the assistant's system prompt. Used by the
 * M1.7 prompt builder, not by the tool layer — the tool returns the
 * structured result and the adapter decides where (if anywhere) to inline
 * the envelope text.
 *
 * Per plan §M1.6 / Codex F7: book text containing literal `</retrieved>`,
 * `&`, `<`, `>` is XML-escaped so the model cannot mistake it for a closing
 * tag. The opener uses `trust="untrusted"` to remind the model these are
 * data, not instructions.
 */
export function serializeForModel(passage: {
  cfi: string;
  chapter?: string;
  text: string;
}): string {
  const escapedText = xmlEscape(passage.text);
  const escapedCfi = xmlAttrEscape(passage.cfi);
  const chapterAttr = passage.chapter ? ` chapter="${xmlAttrEscape(passage.chapter)}"` : '';
  return `<retrieved trust="untrusted" cfi="${escapedCfi}"${chapterAttr}>${escapedText}</retrieved>`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlAttrEscape(s: string): string {
  return xmlEscape(s).replace(/"/g, '&quot;');
}
