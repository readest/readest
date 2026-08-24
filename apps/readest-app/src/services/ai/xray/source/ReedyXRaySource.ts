import * as CFI from 'foliate-js/epubcfi.js';

import type { BookDoc } from '@/libs/document';
import type { AISettings } from '@/services/ai/types';
import type { XRayBookFingerprint, XRaySourceUnit } from '@/services/ai/xray/types';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import type { BookMeta } from '@/services/reedy/db/types';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import { BookIndexer, type IndexBookOptions } from '@/services/reedy/retrieval/BookIndexer';
import { BookRetriever, type RetrieverResult } from '@/services/reedy/retrieval/BookRetriever';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

interface ChunkRow extends DatabaseRow {
  id: string;
  section_index: number;
  start_cfi: string;
  end_cfi: string;
  position_index: number;
  text: string;
}

export type XRaySourceStatus =
  | { readonly kind: 'not_indexed' }
  | { readonly kind: 'indexing' }
  | { readonly kind: 'empty_index'; readonly fingerprint: XRayBookFingerprint }
  | { readonly kind: 'failed'; readonly error: string | null }
  | {
      readonly kind: 'stale_index';
      readonly activeModel: string;
      readonly indexedModel: string;
    }
  | {
      readonly kind: 'ready';
      readonly fingerprint: XRayBookFingerprint;
      readonly maxPositionIndex: number;
    };

export interface XRaySourceSlice {
  readonly fingerprint: XRayBookFingerprint;
  readonly units: readonly XRaySourceUnit[];
  readonly maxPositionIndex: number;
}

export class ReedyXRaySource {
  private readonly indexer: Pick<BookIndexer, 'indexBook'>;
  private readonly retriever: Pick<BookRetriever, 'search'>;

  constructor(
    private readonly db: DatabaseService,
    private readonly reedy: Pick<ReedyDb, 'getBookMeta'>,
    private readonly embeddingModel: EmbeddingModel,
    indexer?: Pick<BookIndexer, 'indexBook'>,
    retriever?: Pick<BookRetriever, 'search'>,
  ) {
    this.indexer = indexer ?? new BookIndexer(reedy as ReedyDb);
    this.retriever = retriever ?? new BookRetriever(reedy as ReedyDb);
  }

  static async open(
    appService: AppService,
    settings: AISettings,
    embeddingModel?: EmbeddingModel,
  ): Promise<ReedyXRaySource> {
    const db = await appService.openDatabase('reedy', 'reedy.db', 'Data', {
      experimental: ['index_method'],
    });
    const reedy = new ReedyDb(db);
    const embedding =
      embeddingModel ?? (await import('./models')).createXRayModels(settings).embedding;
    return new ReedyXRaySource(db, reedy, embedding);
  }

  async getStatus(bookHash: string): Promise<XRaySourceStatus> {
    return this.statusFromMeta(bookHash, await this.reedy.getBookMeta(bookHash));
  }

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    options: IndexBookOptions = {},
  ): Promise<void> {
    const vectors = await this.embeddingModel.embed(['Readest X-Ray index initialization'], {
      signal: options.signal,
    });
    if (!vectors[0]) throw new Error('Embedding model returned no warm-up vector');
    void this.embeddingModel.dim;
    await this.indexer.indexBook(bookDoc, bookHash, this.embeddingModel, options);
  }

  async readThrough(bookHash: string, currentCfi: string): Promise<XRaySourceSlice> {
    const status = await this.getStatus(bookHash);
    if (status.kind !== 'ready') throw unavailableError(status);

    const rows = await this.db.select<ChunkRow>(
      `SELECT id, section_index, start_cfi, end_cfi, position_index, text
       FROM reedy_book_chunks
       WHERE book_hash = ?
       ORDER BY position_index`,
      [bookHash],
    );

    const units: XRaySourceUnit[] = [];
    for (const row of rows) {
      if (CFI.compare(row.end_cfi, currentCfi) > 0) break;
      units.push({
        unitId: row.id,
        startCfi: row.start_cfi,
        endCfi: row.end_cfi,
        sectionIndex: row.section_index,
        positionIndex: row.position_index,
        text: row.text,
      });
    }

    const finalStatus = this.statusFromMeta(bookHash, await this.reedy.getBookMeta(bookHash));
    if (
      finalStatus.kind !== 'ready' ||
      finalStatus.fingerprint.contentHash !== status.fingerprint.contentHash
    ) {
      throw new Error('Reedy index changed while X-Ray was reading it');
    }

    return {
      fingerprint: status.fingerprint,
      units,
      maxPositionIndex: units.at(-1)?.positionIndex ?? -1,
    };
  }

  async searchThrough(
    bookHash: string,
    query: string,
    currentCfi: string,
    k: number,
  ): Promise<RetrieverResult> {
    const { maxPositionIndex } = await this.readThrough(bookHash, currentCfi);
    if (maxPositionIndex < 0) return { passages: [], status: 'ok' };

    return this.retriever.search({
      bookHash,
      query,
      k,
      spoilerBoundPosition: maxPositionIndex,
      activeEmbeddingModel: this.embeddingModel,
    });
  }

  private statusFromMeta(bookHash: string, meta: BookMeta | null): XRaySourceStatus {
    if (!meta) return { kind: 'not_indexed' };
    if (meta.indexingStatus === 'indexing') return { kind: 'indexing' };
    if (meta.indexingStatus === 'failed') return { kind: 'failed', error: meta.error };

    if (meta.embeddingModel !== this.embeddingModel.id) {
      return {
        kind: 'stale_index',
        activeModel: this.embeddingModel.id,
        indexedModel: meta.embeddingModel,
      };
    }

    const fingerprint = toFingerprint(bookHash, meta);
    if (meta.indexingStatus === 'empty_index' || meta.chunkCount === 0) {
      return { kind: 'empty_index', fingerprint };
    }

    return {
      kind: 'ready',
      fingerprint,
      maxPositionIndex: meta.chunkCount - 1,
    };
  }
}

const toFingerprint = (bookHash: string, meta: BookMeta): XRayBookFingerprint => ({
  bookHash,
  contentHash: [meta.embeddingModel, meta.embeddingDim, meta.chunkCount, meta.indexedAt ?? 0].join(
    ':',
  ),
});

const unavailableError = (status: Exclude<XRaySourceStatus, { kind: 'ready' }>): Error => {
  switch (status.kind) {
    case 'not_indexed':
      return new Error('Reedy has not indexed this book');
    case 'indexing':
      return new Error('Reedy is still indexing this book');
    case 'empty_index':
      return new Error('Reedy found no readable text in this book');
    case 'failed':
      return new Error(status.error ?? 'Reedy failed to index this book');
    case 'stale_index':
      return new Error('Reedy must re-index this book with the active embedding model');
  }
};
