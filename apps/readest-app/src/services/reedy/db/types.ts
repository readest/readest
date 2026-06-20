/**
 * Public types for the Reedy retrieval layer. Kept narrow on purpose — the
 * MVP locks one embedding model per database lifetime, so we don't need
 * per-model routing types here. See plan §M1.2 and Appendix A for the
 * deferred multi-model story.
 */

export type IndexingStatus = 'not_indexed' | 'indexing' | 'indexed' | 'failed' | 'empty_index';

export interface BookMeta {
  bookHash: string;
  indexingStatus: IndexingStatus;
  chunkCount: number;
  embeddingModel: string;
  embeddingDim: number;
  indexedAt: number | null;
  error: string | null;
}

export interface ChunkRow {
  id: string;
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string | null;
  startCfi: string;
  endCfi: string;
  positionIndex: number;
  text: string;
  tokenCount: number;
}

export interface EmbeddingRow {
  chunkId: string;
  bookHash: string;
  embedding: number[];
}

/**
 * A chunk returned by hybridSearch, annotated with the RRF-fused score and
 * which retrieval paths surfaced it. Per-path ranks are 1-indexed; `null`
 * means the path didn't surface this chunk in its top-K.
 */
export interface ScoredChunk extends ChunkRow {
  score: number;
  vectorRank: number | null;
  ftsRank: number | null;
}

// ---------------------------------------------------------------------------
// Memory (Phase 3.1)
// ---------------------------------------------------------------------------

export type MemoryScope = 'user' | 'book' | 'session';

export interface MemoryRow {
  id: string;
  scope: MemoryScope;
  scopeKey: string;
  key: string;
  summary: string;
  sourceMessageId: string | null;
  updatedAt: number;
}

export interface MemoryWriteArgs {
  scope: MemoryScope;
  scopeKey: string;
  key: string;
  summary: string;
  sourceMessageId?: string | null;
  /** Optional embedding for the summary — caller embeds + supplies. */
  embedding?: number[] | null;
}

export interface MemorySearchArgs {
  scope: MemoryScope;
  scopeKey: string;
  /** When provided, ranks via vector cosine + recency boost. When omitted, recency only. */
  queryEmbedding?: number[];
  limit: number;
  /**
   * Weight for the recency component when both vector + recency are
   * active. 0 = pure vector, 1 = pure recency. Default 0.1.
   */
  recencyWeight?: number;
}

export interface ScoredMemoryRow extends MemoryRow {
  /** Fused score for the search; lower = more relevant (distance-based). */
  score: number;
  /** Distance from queryEmbedding when vector search ran. null otherwise. */
  vectorDistance: number | null;
}
