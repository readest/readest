import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

const openOPDSDb = (appService: AppService) => appService.openDatabase('opds', 'opds.db', 'Data');

export const upsertOPDSSourceMapping = async (
  appService: AppService,
  input: { catalogId: string; sourceUrl: string; bookHash: string },
): Promise<void> => {
  if (!input.catalogId || !input.sourceUrl || !input.bookHash) return;

  const db = await openOPDSDb(appService);
  try {
    await db.execute(
      `
        INSERT INTO opds_source_mappings (catalog_id, source_url, book_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(catalog_id, source_url)
        DO UPDATE SET book_hash = excluded.book_hash
      `,
      [input.catalogId, input.sourceUrl, input.bookHash],
    );
  } finally {
    await db.close();
  }
};

export const findBookByOPDSSources = async (
  appService: AppService,
  input: { catalogId: string; sourceUrls: string[]; library: Book[] },
): Promise<Book | null> => {
  const sourceUrls = Array.from(new Set(input.sourceUrls.filter(Boolean)));
  if (!input.catalogId || sourceUrls.length === 0 || input.library.length === 0) return null;

  const db = await openOPDSDb(appService);
  try {
    const rows = await db.select<{ book_hash: string }>(
      `
        SELECT book_hash
        FROM opds_source_mappings
        WHERE catalog_id = ?
          AND source_url IN (${sourceUrls.map(() => '?').join(', ')})
      `,
      [input.catalogId, ...sourceUrls],
    );
    return (
      rows
        .map((row) => input.library.find((book) => book.hash === row.book_hash && !book.deletedAt))
        .find(Boolean) ?? null
    );
  } finally {
    await db.close();
  }
};
