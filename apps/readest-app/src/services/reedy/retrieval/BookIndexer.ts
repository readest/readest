import type { BookDoc } from '@/libs/document';
import { ReedyDb } from '../db/ReedyDb';
import type { ChunkRow, EmbeddingRow } from '../db/types';
import type { EmbeddingModel } from '../models/EmbeddingModel';
import { chunkSection, type ChunkOptions } from './CfiChunker';

const DEFAULT_BATCH_SIZE = 16;

export interface IndexBookOptions {
  /** Override CfiChunker tuning. Falls back to chunker defaults. */
  chunkOptions?: Partial<ChunkOptions>;
  /** Optional callback for progress reporting. Phases: 'chunking' | 'embedding'. */
  onProgress?: (event: { phase: 'chunking' | 'embedding'; current: number; total: number }) => void;
  /** Optional chapter-title resolver; defaults to `Section ${i + 1}`. */
  getChapterTitle?: (sectionIndex: number) => string | null;
  /** AbortSignal honoured by the embedding model. */
  signal?: AbortSignal;
}

/**
 * Orchestrates one book's indexing pipeline:
 *   1. mutex per book so concurrent calls serialize
 *   2. chunk every section via CfiChunker
 *   3. lazy-create the embeddings table at the active model's dim
 *   4. embed in model-sized batches and insert
 *   5. land a terminal status (indexed | empty_index | failed) on reedy_book_meta
 *
 * The caller decides when to call this (settings panel "Index this book"
 * button, library-import hook, etc). Failures throw — the caller surfaces
 * the error to the user — but the meta row is updated to 'failed' first so
 * subsequent BookRetriever calls return a useful status.
 */
export class BookIndexer {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly reedy: ReedyDb) {}

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    model: EmbeddingModel,
    options: IndexBookOptions = {},
  ): Promise<void> {
    // Chain on whatever's already in flight for this book so concurrent
    // callers serialize. We register the chained promise synchronously
    // (before any await) so a second concurrent caller sees the chain even
    // if no prior run had been registered when we entered.
    const prior = this.inflight.get(bookHash);
    const promise = (prior ? prior.catch(() => undefined) : Promise.resolve()).then(() =>
      this.runIndex(bookDoc, bookHash, model, options),
    );
    this.inflight.set(bookHash, promise);
    try {
      await promise;
    } finally {
      // Only clear if this is still the tail of the chain — a subsequent
      // caller may have appended after us and we shouldn't drop that.
      if (this.inflight.get(bookHash) === promise) {
        this.inflight.delete(bookHash);
      }
    }
  }

  private async runIndex(
    bookDoc: BookDoc,
    bookHash: string,
    model: EmbeddingModel,
    options: IndexBookOptions,
  ): Promise<void> {
    await this.reedy.upsertBookMeta({
      bookHash,
      indexingStatus: 'indexing',
      chunkCount: 0,
      embeddingModel: model.id,
      embeddingDim: model.dim,
      indexedAt: null,
      error: null,
    });
    // Re-indexing must replace, not duplicate — drop any prior chunks +
    // embeddings for this book before writing the new ones. The meta row
    // upserted above is preserved (clearBookChunks only touches the chunk
    // and embedding tables).
    await this.reedy.clearBookChunks(bookHash);

    try {
      const chunks = await this.collectChunks(bookDoc, bookHash, options);

      if (chunks.length === 0) {
        await this.reedy.setIndexingStatus(bookHash, 'empty_index', {
          chunkCount: 0,
          indexedAt: Date.now(),
          error: null,
        });
        return;
      }

      await this.reedy.ensureEmbeddingsTable(model.dim);
      await this.reedy.insertChunks(chunks);

      await this.embedAndStore(chunks, model, options);

      await this.reedy.setIndexingStatus(bookHash, 'indexed', {
        chunkCount: chunks.length,
        indexedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.reedy.setIndexingStatus(bookHash, 'failed', { error: message });
      throw err;
    }
  }

  private async collectChunks(
    bookDoc: BookDoc,
    bookHash: string,
    options: IndexBookOptions,
  ): Promise<ChunkRow[]> {
    const all: ChunkRow[] = [];
    const sections = bookDoc.sections;
    for (let i = 0; i < sections.length; i++) {
      options.onProgress?.({ phase: 'chunking', current: i, total: sections.length });
      const section = sections[i]!;
      let doc: Document;
      try {
        doc = await section.createDocument();
      } catch (err) {
        console.warn('[Reedy] section createDocument failed', { sectionIndex: i, err });
        continue;
      }
      const title = options.getChapterTitle?.(i) ?? `Section ${i + 1}`;
      const sectionChunks = chunkSection(doc, i, title, bookHash, options.chunkOptions);
      // Rewrite the position index to be monotonic across the whole book —
      // CfiChunker numbers within a section, the indexer needs a global order.
      for (const c of sectionChunks) {
        all.push({ ...c, positionIndex: all.length, id: `${bookHash}-${all.length}` });
      }
    }
    options.onProgress?.({ phase: 'chunking', current: sections.length, total: sections.length });
    return all;
  }

  private async embedAndStore(
    chunks: ChunkRow[],
    model: EmbeddingModel,
    options: IndexBookOptions,
  ): Promise<void> {
    const batchSize = Math.max(1, model.batchSize ?? DEFAULT_BATCH_SIZE);
    const total = chunks.length;
    let done = 0;
    for (let i = 0; i < total; i += batchSize) {
      if (options.signal?.aborted) {
        throw new Error('indexing aborted');
      }
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await model.embed(
        batch.map((c) => c.text),
        { signal: options.signal },
      );
      if (vectors.length !== batch.length) {
        throw new Error(
          `embedding model returned ${vectors.length} vectors for ${batch.length} inputs`,
        );
      }
      const rows: EmbeddingRow[] = batch.map((c, j) => {
        const v = vectors[j]!;
        if (v.length !== model.dim) {
          throw new Error(
            `embedding for chunk ${c.id} has length ${v.length}, expected dim ${model.dim}`,
          );
        }
        return { chunkId: c.id, bookHash: c.bookHash, embedding: v };
      });
      await this.reedy.insertEmbeddings(rows);
      done += batch.length;
      options.onProgress?.({ phase: 'embedding', current: done, total });
    }
  }
}
