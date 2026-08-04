import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BookOrbitSyncStore } from '@/services/bookorbit/BookOrbitSyncStore';
import type { AppService } from '@/types/system';

type MappingRow = {
  book_hash: string;
  note_id: string;
  server_id: number | null;
  ko_datetime: string;
  synced_at: number;
};

type BookSyncRow = {
  book_hash: string;
  annotations_synced_at: number;
  bookmarks_synced_at: number;
};

describe('BookOrbitSyncStore', () => {
  let mockAppService: AppService;
  const mappings = new Map<string, MappingRow>();
  const bookSync = new Map<string, BookSyncRow>();

  beforeEach(() => {
    vi.clearAllMocks();
    mappings.clear();
    bookSync.clear();

    const mockDb = {
      select: vi.fn(async (sql: string, params: unknown[] = []) => {
        const bookHash = params[0] as string;
        if (/FROM bookorbit_note_mappings/i.test(sql)) {
          return Array.from(mappings.values()).filter((row) => row.book_hash === bookHash);
        }
        if (/FROM bookorbit_book_sync/i.test(sql)) {
          const row = bookSync.get(bookHash);
          return row ? [row] : [];
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (/INSERT INTO bookorbit_note_mappings/i.test(sql)) {
          const [book_hash, note_id, server_id, ko_datetime, synced_at] = params as [
            string,
            string,
            number | null,
            string,
            number,
          ];
          mappings.set(`${book_hash} ${note_id}`, {
            book_hash,
            note_id,
            server_id,
            ko_datetime,
            synced_at,
          });
        }
        if (/INSERT INTO bookorbit_book_sync/i.test(sql)) {
          const [book_hash, annotations_synced_at, bookmarks_synced_at] = params as [
            string,
            number,
            number,
          ];
          bookSync.set(book_hash, { book_hash, annotations_synced_at, bookmarks_synced_at });
        }
        return {};
      }),
      close: vi.fn().mockResolvedValue({}),
    };

    mockAppService = {
      openDatabase: vi.fn().mockResolvedValue(mockDb),
    } as unknown as AppService;
  });

  test('identity round-trips through flush and a fresh load', async () => {
    const store = new BookOrbitSyncStore(mockAppService);
    await store.setIdentity('bookA', 'note1', { datetime: '2026-08-01 10:00:00', serverId: 42 });
    await store.flush();

    const reloaded = new BookOrbitSyncStore(mockAppService);
    expect(await reloaded.getIdentity('bookA', 'note1')).toEqual({
      datetime: '2026-08-01 10:00:00',
      serverId: 42,
    });
    expect(await reloaded.getIdentity('bookA', 'missing')).toBeNull();
  });

  test('getIdentities returns all mappings of the loaded book', async () => {
    const store = new BookOrbitSyncStore(mockAppService);
    await store.setIdentity('bookA', 'note1', { datetime: '2026-08-01 10:00:00', serverId: 1 });
    await store.setIdentity('bookA', 'note2', { datetime: '2026-08-01 11:00:00', serverId: null });
    const all = await store.getIdentities('bookA');
    expect(all.size).toBe(2);
    expect(all.get('note2')).toEqual({ datetime: '2026-08-01 11:00:00', serverId: null });
  });

  test('watermarks default to zero and round-trip per kind', async () => {
    const store = new BookOrbitSyncStore(mockAppService);
    expect(await store.getWatermark('bookA', 'annotations')).toBe(0);
    await store.setWatermark('bookA', 'annotations', 111);
    await store.setWatermark('bookA', 'bookmarks', 222);
    await store.flush();

    const reloaded = new BookOrbitSyncStore(mockAppService);
    expect(await reloaded.getWatermark('bookA', 'annotations')).toBe(111);
    expect(await reloaded.getWatermark('bookA', 'bookmarks')).toBe(222);
  });

  test('switching books auto-loads the right rows', async () => {
    const store = new BookOrbitSyncStore(mockAppService);
    await store.setIdentity('bookA', 'note1', { datetime: '2026-08-01 10:00:00', serverId: 1 });
    await store.flush();
    await store.setIdentity('bookB', 'noteX', { datetime: '2026-08-02 10:00:00', serverId: 2 });
    await store.flush();

    expect(await store.getIdentity('bookA', 'note1')).toEqual({
      datetime: '2026-08-01 10:00:00',
      serverId: 1,
    });
    expect(await store.getIdentity('bookB', 'noteX')).toEqual({
      datetime: '2026-08-02 10:00:00',
      serverId: 2,
    });
  });
});
