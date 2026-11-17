import type { Book } from '@/types/book';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

// One connection at a time. On web opds.db is a single OPFS file with one
// exclusive access handle, and auto-download looks up and records sources for
// several books at once, so overlapping opens failed with "database is
// locked" or raced a fresh file into "short read on page 1" (#7489).
let queue: Promise<unknown> = Promise.resolve();

const withOPDSDb = <T>(
  appService: AppService,
  fn: (db: DatabaseService) => Promise<T>,
): Promise<T> => {
  const run = queue.then(async () => {
    const db = await appService.openDatabase('opds', 'opds.db', 'Data');
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  });
  queue = run.catch(() => {});
  return run;
};

export const upsertOPDSSourceMapping = async (
  appService: AppService,
  input: { catalogId: string; sourceUrl: string; bookHash: string },
): Promise<void> => {
  if (!input.catalogId || !input.sourceUrl || !input.bookHash) return;

  await withOPDSDb(appService, (db) =>
    db.execute(
      `
        INSERT INTO opds_source_mappings (catalog_id, source_url, book_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(catalog_id, source_url)
        DO UPDATE SET book_hash = excluded.book_hash
      `,
      [input.catalogId, input.sourceUrl, input.bookHash],
    ),
  );
};

export const findBookByOPDSSources = async (
  appService: AppService,
  input: { catalogId: string; sourceUrls: string[]; library: Book[] },
): Promise<Book | null> => {
  const sourceUrls = Array.from(new Set(input.sourceUrls.filter(Boolean)));
  if (!input.catalogId || sourceUrls.length === 0 || input.library.length === 0) return null;

  const rows = await withOPDSDb(appService, (db) =>
    db.select<{ book_hash: string }>(
      `
        SELECT book_hash
        FROM opds_source_mappings
        WHERE catalog_id = ?
          AND source_url IN (${sourceUrls.map(() => '?').join(', ')})
      `,
      [input.catalogId, ...sourceUrls],
    ),
  );
  return (
    rows
      .map((row) => input.library.find((book) => book.hash === row.book_hash && !book.deletedAt))
      .find(Boolean) ?? null
  );
};
