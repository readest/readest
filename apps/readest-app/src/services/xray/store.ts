import * as CFI from 'foliate-js/epubcfi.js';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { XRay } from './snapshot';
import type { XRayData } from './types';

interface XRayBatch {
  position: number;
  endCfi: string;
  data: XRayData;
}

let opening: Promise<DatabaseService> | null = null;
// The book being read, with its first `count` batches merged. Page turns only
// compare CFIs; one that admits another batch adds that one.
let cached: { bookHash: string; batches: XRayBatch[]; count: number; merged: XRay } | null = null;

const openDb = (appService: AppService): Promise<DatabaseService> => {
  if (!opening) {
    opening = appService.openDatabase('xray', 'xray.db', 'Data');
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
};

export const __resetXRayStoreForTests = () => {
  opening = null;
  cached = null;
};

const load = async (appService: AppService, bookHash: string) => {
  if (cached?.bookHash === bookHash) return cached;
  const db = await openDb(appService);
  const rows = await db.select<
    DatabaseRow & { position: number; end_cfi: string; payload: string }
  >('SELECT position, end_cfi, payload FROM xray_batches WHERE book_hash = ? ORDER BY position', [
    bookHash,
  ]);
  const batches = rows.map(({ position, end_cfi, payload }) => ({
    position,
    endCfi: end_cfi,
    data: JSON.parse(payload) as XRayData,
  }));
  cached = { bookHash, batches, count: 0, merged: new XRay() };
  return cached;
};

/** Where the stored X-Ray of a book ends (-1 when there is none), and the names in it. */
export const getXRayEnd = async (appService: AppService, bookHash: string) => {
  const { batches } = await load(appService, bookHash);
  return {
    position: batches.at(-1)?.position ?? -1,
    names: batches.flatMap(({ data }) => data.entities.map(({ name }) => name)),
  };
};

/** What the stored X-Ray says up to the page at `location`; null before anything is read. */
export const getXRay = async (
  appService: AppService,
  bookHash: string,
  location: string,
): Promise<XRay | null> => {
  const book = await load(appService, bookHash);
  // Batches are in reading order, so the ones read are a prefix.
  let count = 0;
  let end = book.batches.length;
  while (count < end) {
    const middle = (count + end) >> 1;
    if (CFI.compare(book.batches[middle]!.endCfi, location) <= 0) count = middle + 1;
    else end = middle;
  }
  if (count < book.count) {
    book.merged = new XRay();
    book.count = 0;
  }
  if (count > book.count) {
    const added = Object.assign(new XRay(), book.merged);
    for (const { data } of book.batches.slice(book.count, count)) added.add(data);
    book.merged = added;
    book.count = count;
  }
  return count ? book.merged : null;
};

export const saveXRayBatch = async (
  appService: AppService,
  bookHash: string,
  batch: XRayBatch,
): Promise<void> => {
  const db = await openDb(appService);
  await db.execute(
    'INSERT OR REPLACE INTO xray_batches (book_hash, position, end_cfi, payload) VALUES (?, ?, ?, ?)',
    [bookHash, batch.position, batch.endCfi, JSON.stringify(batch.data)],
  );
  if (cached?.bookHash === bookHash) cached.batches.push(batch);
};

export const clearXRay = async (appService: AppService, bookHash: string): Promise<void> => {
  const db = await openDb(appService);
  await db.execute('DELETE FROM xray_batches WHERE book_hash = ?', [bookHash]);
  if (cached?.bookHash === bookHash) cached = null;
};

/** Turso has no auto-checkpoint: fold the WAL into the file after an update. */
export const checkpointXRay = async (appService: AppService): Promise<void> => {
  await (await openDb(appService)).execute('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});
};
