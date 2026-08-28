import * as CFI from 'foliate-js/epubcfi.js';

import type { XRayBookFingerprint, XRaySourceUnit } from '@/services/ai/xray/types';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import type { BookMeta } from '@/services/reedy/db/types';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

type ReadOnlyDatabase = Pick<DatabaseService, 'select'>;
type ReedyMetadataReader = Pick<ReedyDb, 'getBookMeta'>;

interface ReedyConnection {
  readonly db: ReadOnlyDatabase;
  readonly reedy: ReedyMetadataReader;
}

type ReedyConnectionOpener = () => Promise<ReedyConnection | null>;

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
  private connection: ReedyConnection | null;
  private connectionPromise: Promise<ReedyConnection | null> | null = null;

  constructor(
    db: ReadOnlyDatabase | null,
    reedy: ReedyMetadataReader | null,
    private readonly activeEmbeddingModelId: string,
    private readonly openConnection?: ReedyConnectionOpener,
  ) {
    this.connection = db && reedy ? { db, reedy } : null;
  }

  static async open(
    appService: AppService,
    activeEmbeddingModelId: string,
  ): Promise<ReedyXRaySource> {
    const openConnection = () => openExistingReedyDatabase(appService);
    const connection = await openConnection();
    return new ReedyXRaySource(
      connection?.db ?? null,
      connection?.reedy ?? null,
      activeEmbeddingModelId,
      openConnection,
    );
  }

  async getStatus(bookHash: string): Promise<XRaySourceStatus> {
    const connection = await this.getConnection();
    if (!connection) return { kind: 'not_indexed' };
    return this.statusFromMeta(bookHash, await connection.reedy.getBookMeta(bookHash));
  }

  async readThrough(bookHash: string, currentCfi: string): Promise<XRaySourceSlice> {
    const connection = await this.getConnection();
    if (!connection) throw unavailableError({ kind: 'not_indexed' });
    const status = this.statusFromMeta(bookHash, await connection.reedy.getBookMeta(bookHash));
    if (status.kind !== 'ready') throw unavailableError(status);

    const rows = await connection.db.select<ChunkRow>(
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

    const finalStatus = this.statusFromMeta(bookHash, await connection.reedy.getBookMeta(bookHash));
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

  private async getConnection(): Promise<ReedyConnection | null> {
    if (this.connection || !this.openConnection) return this.connection;
    this.connectionPromise ??= this.openConnection();
    try {
      this.connection = await this.connectionPromise;
      return this.connection;
    } finally {
      this.connectionPromise = null;
    }
  }

  private statusFromMeta(bookHash: string, meta: BookMeta | null): XRaySourceStatus {
    if (!meta) return { kind: 'not_indexed' };
    if (meta.indexingStatus === 'indexing') return { kind: 'indexing' };
    if (meta.indexingStatus === 'failed') return { kind: 'failed', error: meta.error };

    if (meta.embeddingModel !== this.activeEmbeddingModelId) {
      return {
        kind: 'stale_index',
        activeModel: this.activeEmbeddingModelId,
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

const openExistingReedyDatabase = async (
  appService: AppService,
): Promise<ReedyConnection | null> => {
  if (!(await appService.databaseExists('reedy.db', 'Data'))) return null;
  const fullPath = await appService.resolveFilePath('reedy.db', 'Data');
  const { NativeDatabaseService } = await import('@/services/database/nativeDatabaseService');
  const db = await NativeDatabaseService.open(`sqlite:${fullPath}`, {
    experimental: ['index_method'],
  });
  return { db, reedy: new ReedyDb(db) };
};

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
