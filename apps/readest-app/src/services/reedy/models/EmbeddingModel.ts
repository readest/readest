/**
 * Minimal embedding-model interface the Reedy retrieval layer talks to.
 *
 * MVP scope: just enough surface for BookIndexer and BookRetriever to drive
 * indexing + query embedding. The actual provider plumbing (Ollama,
 * AIGateway, OpenRouter, ...) lives in `src/services/ai/` and is adapted to
 * this interface by the M1.7 ReedyBackend so we don't have to re-implement
 * provider transports here.
 */
export interface EmbeddingModel {
  /** Stable identifier — matches the `embedding_model` column in reedy_book_meta. */
  readonly id: string;
  /** Vector width. Must match the `vector32(<dim>)` column once the lazy embeddings table exists. */
  readonly dim: number;
  /**
   * Batch size hint for indexing. Ollama and local engines typically prefer
   * small batches (4); hosted providers (AIGateway, OpenAI) accept larger
   * batches (16+). BookIndexer respects this; embedding-time backpressure is
   * the model's responsibility.
   */
  readonly batchSize?: number;
  embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<number[][]>;
}
