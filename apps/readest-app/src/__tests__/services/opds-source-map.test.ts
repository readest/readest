import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { findBookByOPDSSources, upsertOPDSSourceMapping } from '@/services/opds/sourceMap';

type Row = { catalog_id: string; source_url: string; book_hash: string };

class MockDatabase {
  rows: Row[] = [];

  execute = vi.fn(async (_sql: string, params: unknown[] = []) => {
    const [catalog_id = '', source_url = '', book_hash = ''] = params as string[];
    const row = this.rows.find((r) => r.catalog_id === catalog_id && r.source_url === source_url);
    if (row) row.book_hash = book_hash;
    else this.rows.push({ catalog_id, source_url, book_hash });
    return { rowsAffected: 1, lastInsertId: 0 };
  });

  select = vi.fn(async (_sql: string, params: unknown[] = []) => {
    const [catalogId = '', ...urls] = params as string[];
    return this.rows
      .filter((row) => row.catalog_id === catalogId && urls.includes(row.source_url))
      .map((row) => ({ book_hash: row.book_hash }));
  });

  batch = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

const appService = (db: MockDatabase): AppService =>
  ({ openDatabase: vi.fn(async () => db) }) as unknown as AppService;

const book = (hash: string, deletedAt?: number): Book => ({
  hash,
  format: 'EPUB',
  title: '',
  author: '',
  createdAt: 0,
  updatedAt: 0,
  deletedAt,
});

describe('OPDS source map', () => {
  it('maps catalog acquisition URLs to library books', async () => {
    const db = new MockDatabase();
    const service = appService(db);

    await upsertOPDSSourceMapping(service, {
      catalogId: 'calibre',
      sourceUrl: 'https://example.com/book.epub',
      bookHash: 'book',
    });

    expect(db.rows).toEqual([
      { catalog_id: 'calibre', source_url: 'https://example.com/book.epub', book_hash: 'book' },
    ]);
    expect(
      await findBookByOPDSSources(service, {
        catalogId: 'calibre',
        sourceUrls: ['https://example.com/book.epub'],
        library: [book('book')],
      }),
    ).toMatchObject({ hash: 'book' });
  });

  it('ignores mappings to deleted books', async () => {
    const db = new MockDatabase();
    const service = appService(db);

    await upsertOPDSSourceMapping(service, {
      catalogId: 'calibre',
      sourceUrl: 'https://example.com/book.epub',
      bookHash: 'book',
    });

    expect(
      await findBookByOPDSSources(service, {
        catalogId: 'calibre',
        sourceUrls: ['https://example.com/book.epub'],
        library: [book('book', Date.now())],
      }),
    ).toBeNull();
  });
});
