import { migrate } from '@/services/database/migrate';
import type {
  XRayBookFingerprint,
  XRayBookState,
  XRayExtractionBatch,
  XRayLookupCacheRow,
  XRayLookupResult,
} from '@/services/ai/xray/types';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

import { XRAY_MIGRATIONS } from './migrations';

interface BookStateRow extends DatabaseRow {
  fingerprint: string;
  max_position_index: number;
  pending_position_index: number | null;
  last_batch_id: string | null;
  updated_at: number;
  version: number;
  error: string | null;
}

interface BatchRow extends DatabaseRow {
  payload: string;
}

interface LookupRow extends DatabaseRow {
  payload: string;
}

const serializeFingerprint = (fingerprint: XRayBookFingerprint): string =>
  JSON.stringify({ bookHash: fingerprint.bookHash, contentHash: fingerprint.contentHash });

const sqlQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const sqlNullableString = (value: string | undefined): string =>
  value === undefined ? 'NULL' : sqlQuote(value);
const sqlNullableNumber = (value: number | undefined): string =>
  value === undefined ? 'NULL' : String(value);

const stateBatchStatement = (state: XRayBookState): string => `
  INSERT INTO xray_books
    (book_hash, fingerprint, max_position_index, pending_position_index,
     last_batch_id, updated_at, version, error)
  VALUES (
    ${sqlQuote(state.fingerprint.bookHash)},
    ${sqlQuote(serializeFingerprint(state.fingerprint))},
    ${state.maxPositionIndex},
    ${sqlNullableNumber(state.pendingPositionIndex)},
    ${sqlNullableString(state.lastBatchId)},
    ${state.updatedAt},
    ${state.version},
    ${sqlNullableString(state.error)}
  )
  ON CONFLICT(book_hash) DO UPDATE SET
    fingerprint = excluded.fingerprint,
    max_position_index = excluded.max_position_index,
    pending_position_index = excluded.pending_position_index,
    last_batch_id = excluded.last_batch_id,
    updated_at = excluded.updated_at,
    version = excluded.version,
    error = excluded.error
  WHERE xray_books.fingerprint = excluded.fingerprint
    AND excluded.max_position_index >= xray_books.max_position_index
`;

export class XRayStore {
  private commitQueue: Promise<void> = Promise.resolve();

  constructor(private readonly db: DatabaseService) {}

  static async open(appService: AppService): Promise<XRayStore> {
    const db = await appService.openDatabase('xray', 'xray.db', 'Data');
    const store = new XRayStore(db);
    await store.initialize();
    return store;
  }

  async initialize(): Promise<void> {
    await migrate(this.db, XRAY_MIGRATIONS);
  }

  async getState(bookHash: string): Promise<XRayBookState | null> {
    const rows = await this.db.select<BookStateRow>(
      `SELECT fingerprint, max_position_index, pending_position_index,
              last_batch_id, updated_at, version, error
       FROM xray_books
       WHERE book_hash = ?`,
      [bookHash],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      fingerprint: JSON.parse(row.fingerprint) as XRayBookFingerprint,
      maxPositionIndex: row.max_position_index,
      ...(row.pending_position_index === null
        ? {}
        : { pendingPositionIndex: row.pending_position_index }),
      ...(row.last_batch_id === null ? {} : { lastBatchId: row.last_batch_id }),
      updatedAt: row.updated_at,
      version: row.version,
      ...(row.error === null ? {} : { error: row.error }),
    };
  }

  async saveState(state: XRayBookState): Promise<void> {
    await this.db.execute(
      `INSERT INTO xray_books
         (book_hash, fingerprint, max_position_index, pending_position_index,
          last_batch_id, updated_at, version, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_hash) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         max_position_index = excluded.max_position_index,
         pending_position_index = excluded.pending_position_index,
         last_batch_id = excluded.last_batch_id,
         updated_at = excluded.updated_at,
         version = excluded.version,
         error = excluded.error
       WHERE xray_books.fingerprint = excluded.fingerprint
         AND excluded.max_position_index >= xray_books.max_position_index`,
      [
        state.fingerprint.bookHash,
        serializeFingerprint(state.fingerprint),
        state.maxPositionIndex,
        state.pendingPositionIndex ?? null,
        state.lastBatchId ?? null,
        state.updatedAt,
        state.version,
        state.error ?? null,
      ],
    );
  }

  async commitBatch(batch: XRayExtractionBatch, state: XRayBookState): Promise<void> {
    const commit = this.commitQueue.then(() => this.commitBatchNow(batch, state));
    this.commitQueue = commit.catch(() => undefined);
    return commit;
  }

  private async commitBatchNow(batch: XRayExtractionBatch, state: XRayBookState): Promise<void> {
    const invalidateLookups = `
      DELETE FROM xray_lookups
      WHERE book_hash = ${sqlQuote(batch.fingerprint.bookHash)}
        AND fingerprint = ${sqlQuote(serializeFingerprint(batch.fingerprint))}
        AND max_position_index >= ${batch.minPositionIndex}
    `;
    const batchStatement = `
      INSERT OR IGNORE INTO xray_batches
        (batch_id, book_hash, fingerprint, min_position_index, max_position_index, payload)
      VALUES (
        ${sqlQuote(batch.batchId)},
        ${sqlQuote(batch.fingerprint.bookHash)},
        ${sqlQuote(serializeFingerprint(batch.fingerprint))},
        ${batch.minPositionIndex},
        ${batch.maxPositionIndex},
        ${sqlQuote(JSON.stringify(batch))}
      )
    `;

    await this.db.batch([batchStatement, invalidateLookups, stateBatchStatement(state)]);
  }

  async listBatches(bookHash: string, maxPositionIndex: number): Promise<XRayExtractionBatch[]> {
    const rows = await this.db.select<BatchRow>(
      `SELECT payload
       FROM xray_batches
       WHERE book_hash = ? AND max_position_index <= ?
       ORDER BY min_position_index, max_position_index, batch_id`,
      [bookHash, maxPositionIndex],
    );
    return rows.map(({ payload }) => JSON.parse(payload) as XRayExtractionBatch);
  }

  async getLookup(
    key: string,
    bookHash: string,
    maxPositionIndex: number,
    fingerprint: XRayBookFingerprint,
  ): Promise<XRayLookupResult | null> {
    const rows = await this.db.select<LookupRow>(
      `SELECT payload
       FROM xray_lookups
       WHERE lookup_key = ?
         AND book_hash = ?
         AND max_position_index = ?
         AND fingerprint = ?`,
      [key, bookHash, maxPositionIndex, serializeFingerprint(fingerprint)],
    );
    const row = rows[0];
    return row ? (JSON.parse(row.payload) as XRayLookupResult) : null;
  }

  async saveLookup(lookup: XRayLookupCacheRow): Promise<void> {
    await this.db.execute(
      `INSERT INTO xray_lookups
         (lookup_key, book_hash, max_position_index, fingerprint, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lookup_key, book_hash, max_position_index, fingerprint)
       DO UPDATE SET payload = excluded.payload`,
      [
        lookup.key,
        lookup.bookHash,
        lookup.maxPositionIndex,
        serializeFingerprint(lookup.fingerprint),
        JSON.stringify(lookup.result),
      ],
    );
  }

  async clearBook(bookHash: string): Promise<void> {
    const quotedBookHash = sqlQuote(bookHash);
    await this.db.batch([
      `DELETE FROM xray_lookups WHERE book_hash = ${quotedBookHash}`,
      `DELETE FROM xray_batches WHERE book_hash = ${quotedBookHash}`,
      `DELETE FROM xray_books WHERE book_hash = ${quotedBookHash}`,
    ]);
  }
}
