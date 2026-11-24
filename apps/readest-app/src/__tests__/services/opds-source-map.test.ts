// @vitest-environment node
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

  it('opens one connection at a time when lookups and writes overlap', async () => {
    // On web opds.db is one OPFS file with a single exclusive access handle,
    // so a second open while one is live fails ("database is locked"). The
    // auto-download loop runs lookups and writes concurrently (#7489).
    const db = new MockDatabase();
    let open = 0;
    const service = {
      openDatabase: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (open > 0) throw new Error('database is locked');
        open++;
        return {
          ...db,
          close: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            open--;
          }),
        };
      }),
    } as unknown as AppService;

    await expect(
      Promise.all([
        upsertOPDSSourceMapping(service, {
          catalogId: 'calibre',
          sourceUrl: 'https://example.com/a.epub',
          bookHash: 'a',
        }),
        findBookByOPDSSources(service, {
          catalogId: 'calibre',
          sourceUrls: ['https://example.com/b.epub'],
          library: [book('b')],
        }),
        upsertOPDSSourceMapping(service, {
          catalogId: 'calibre',
          sourceUrl: 'https://example.com/c.epub',
          bookHash: 'c',
        }),
      ]),
    ).resolves.toEqual([undefined, null, undefined]);
    expect(db.rows.map((row) => row.book_hash)).toEqual(['a', 'c']);
  });

  it('keeps serving after a failed open', async () => {
    const db = new MockDatabase();
    const service = {
      openDatabase: vi
        .fn()
        .mockRejectedValueOnce(new Error('short read on page 1'))
        .mockResolvedValue(db),
    } as unknown as AppService;

    await expect(
      upsertOPDSSourceMapping(service, {
        catalogId: 'calibre',
        sourceUrl: 'https://example.com/a.epub',
        bookHash: 'a',
      }),
    ).rejects.toThrow('short read on page 1');
    await upsertOPDSSourceMapping(service, {
      catalogId: 'calibre',
      sourceUrl: 'https://example.com/a.epub',
      bookHash: 'a',
    });
    expect(db.rows).toHaveLength(1);
  });
});
