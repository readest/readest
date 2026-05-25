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
