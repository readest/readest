import type { ReedyDb } from '../db/ReedyDb';
import type { EmbeddingModel } from '../models/EmbeddingModel';

/**
 * Status the retriever reports back so the lookupPassage tool can phrase the
 * model's response, and so the UI can offer an appropriate next action
 * (e.g. "Index this book", "Re-index with new model"). `budget_exceeded` is
 * intentionally NOT part of this union — that status is surfaced by the
 * lookupPassage tool layer when it refuses to call the retriever again.
 */
export type RetrieverStatus = 'ok' | 'not_indexed' | 'empty_index' | 'stale_index' | 'degraded';

export interface RetrievedChunk {
  id: string;
  bookHash: string;
  /** The chunk's start CFI — the navigable anchor handed to the UI. */
  cfi: string;
  /** End CFI, useful for highlighting or future tool operations. */
  endCfi: string;
  chapterTitle: string | null;
  text: string;
  positionIndex: number;
  /** Fused RRF score; informational only. */
  score: number;
}

export interface RetrieverResult {
  passages: RetrievedChunk[];
  status: RetrieverStatus;
  /** Human-readable reason for non-`ok` statuses; surfaced to the user via the model. */
  reason?: string;
}

export interface RetrieveArgs {
  bookHash: string;
  query: string;
  k: number;
  spoilerBoundPosition?: number;
  activeEmbeddingModel: EmbeddingModel;
  /** Query embedding wall-clock budget. @default 5000 */
  embeddingTimeoutMs?: number;
}

const DEFAULT_EMBEDDING_TIMEOUT_MS = 5000;

/**
 * Per plan §M1.5 — wraps ReedyDb.hybridSearch with status detection and
 * graceful degradation. The retriever:
 *
 *   1. checks reedy_book_meta → returns `not_indexed` / `empty_index` /
 *      `stale_index` without touching the chunks/embeddings tables;
 *   2. embeds the user's query with a wall-clock budget; on timeout it
 *      reports `degraded` and falls through to FTS-only fusion;
 *   3. calls hybridSearch (vector cosine + Tantivy FTS + RRF) filtered by
 *      bookHash and spoilerBoundPosition;
 *   4. shapes ScoredChunk → RetrievedChunk for the tool layer.
 */
export class BookRetriever {
  constructor(private readonly reedy: ReedyDb) {}

  async search(args: RetrieveArgs): Promise<RetrieverResult> {
    const meta = await this.reedy.getBookMeta(args.bookHash);
    if (!meta) {
      return { passages: [], status: 'not_indexed' };
    }
    // Check indexing_status FIRST so 'indexing' / 'failed' rows (which start
    // life with chunk_count=0) report not_indexed instead of empty_index.
    if (meta.indexingStatus === 'empty_index') {
      return { passages: [], status: 'empty_index' };
    }
    if (meta.indexingStatus !== 'indexed') {
      // 'indexing' / 'failed' fall here — no usable corpus yet.
      return { passages: [], status: 'not_indexed' };
    }
    if (meta.chunkCount === 0) {
      // Indexed but zero chunks — same shape as empty_index.
      return { passages: [], status: 'empty_index' };
    }
    if (meta.embeddingModel !== args.activeEmbeddingModel.id) {
      return {
        passages: [],
        status: 'stale_index',
        reason: `${args.activeEmbeddingModel.id} is selected but this book was indexed with ${meta.embeddingModel}; re-index required`,
      };
    }

    const timeoutMs = args.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    const { embedding, degraded, reason } = await embedQueryWithTimeout(
      args.activeEmbeddingModel,
      args.query,
      timeoutMs,
    );

    const scored = await this.reedy.hybridSearch({
      bookHash: args.bookHash,
      queryText: args.query,
      // When the embedding times out we fall back to FTS-only by passing a
      // zero vector — vector_distance_cos will produce uniform distances and
      // contribute nothing useful to the RRF; FTS still ranks meaningfully.
      queryEmbedding: embedding ?? new Array(args.activeEmbeddingModel.dim).fill(0),
      k: args.k,
      spoilerBoundPosition: args.spoilerBoundPosition,
    });

    const passages: RetrievedChunk[] = scored.map((s) => ({
      id: s.id,
      bookHash: s.bookHash,
      cfi: s.startCfi,
      endCfi: s.endCfi,
      chapterTitle: s.chapterTitle,
      text: s.text,
      positionIndex: s.positionIndex,
      score: s.score,
    }));

    if (degraded) {
      return { passages, status: 'degraded', reason };
    }
    return { passages, status: 'ok' };
  }
}

async function embedQueryWithTimeout(
  model: EmbeddingModel,
  query: string,
  timeoutMs: number,
): Promise<{ embedding: number[] | null; degraded: boolean; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await model.embed([query], { signal: controller.signal });
    const v = result[0];
    if (!v || v.length !== model.dim) {
      return {
        embedding: null,
        degraded: true,
        reason: `embedding_dim_mismatch: model returned ${v?.length ?? 'no'} values, expected ${model.dim}`,
      };
    }
    return { embedding: v, degraded: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      embedding: null,
      degraded: true,
      reason: controller.signal.aborted
        ? `embedding_timeout after ${timeoutMs}ms`
        : `embedding_failed: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
