import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';
import type { AppService } from '@/types/system';

type HardcoverSyncMapRow = {
  book_hash: string;
  note_id: string;
  hardcover_journal_id: number;
  payload_hash: string;
  synced_at: number;
};

type MockDb = {
  rows: Map<string, HardcoverSyncMapRow>;
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

describe('HardcoverSyncMapStore', () => {
  let mockAppService: AppService;
  let mockDb: MockDb;
  let store: HardcoverSyncMapStore;

  const makeRowKey = (bookHash: string, noteId: string) => `${bookHash}\0${noteId}`;

  beforeEach(() => {
    vi.clearAllMocks();

    // In-memory mock that mirrors the real upsert + select-by-book semantics.
    const rows = new Map<string, HardcoverSyncMapRow>();

    mockDb = {
      rows,
      select: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (/FROM hardcover_note_mappings/i.test(sql)) {
          const bookHash = params[0] as string;
          return Array.from(rows.values()).filter((row) => row.book_hash === bookHash);
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (/DELETE FROM hardcover_note_mappings/i.test(sql)) {
          const bookHash = params[0] as string;
          for (const [key, row] of rows) {
            if (row.book_hash === bookHash) rows.delete(key);
          }
          return {};
        }
        if (/INSERT INTO hardcover_note_mappings/i.test(sql)) {
          const [book_hash, note_id, hardcover_journal_id, payload_hash, synced_at] = params as [
            string,
            string,
            number,
            string,
            number,
          ];
          rows.set(makeRowKey(book_hash, note_id), {
            book_hash,
            note_id,
            hardcover_journal_id,
            payload_hash,
            synced_at,
          });
        }
        return {};
      }),
      close: vi.fn().mockResolvedValue({}),
    };

    mockAppService = {
      openDatabase: vi.fn().mockResolvedValue(mockDb),
    } as unknown as AppService;

    // Fresh localStorage mock per test
    const localStorageMock = (() => {
      let data: Record<string, string> = {};
      return {
        getItem: vi.fn((key: string) => data[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          data[key] = String(value);
        }),
        key: vi.fn((index: number) => Object.keys(data)[index] ?? null),
        removeItem: vi.fn((key: string) => {
          delete data[key];
        }),
        clear: vi.fn(() => {
          data = {};
        }),
        get length() {
          return Object.keys(data).length;
        },
      };
    })();

    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    store = new HardcoverSyncMapStore(mockAppService);
  });

  test('loads mappings from the database', async () => {
    const bookHash = 'test-book-hash';
    const noteId = 'note-1';
    const mapping: HardcoverSyncMapRow = {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 123,
      payload_hash: 'abc',
      synced_at: 1000,
    };
    mockDb.rows.set(makeRowKey(bookHash, noteId), mapping);

    await store.loadForBook(bookHash);
    const result = await store.getMapping(bookHash, noteId);

    expect(result).toEqual(mapping);
    expect(mockAppService.openDatabase).toHaveBeenCalledWith(
      'hardcover-sync',
      'hardcover-sync.db',
      'Data',
    );
  });

  test('upsertMapping marks dirty and flush persists to the database', async () => {
    const bookHash = 'test-book-hash';
    const noteId = 'note-1';

    await store.upsertMapping(bookHash, noteId, 456, 'def');
    await store.flush();

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hardcover_note_mappings'),
      expect.arrayContaining([bookHash, noteId, 456, 'def']),
    );
    const stored = mockDb.rows.get(makeRowKey(bookHash, noteId));
    expect(stored?.hardcover_journal_id).toBe(456);
    expect(stored?.payload_hash).toBe('def');
  });

  test('flush is a no-op when nothing was modified', async () => {
    await store.loadForBook('book-1');
    mockDb.execute.mockClear();

    await store.flush();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  test('getMappingByPayloadHash returns the most recently synced match', async () => {
    const bookHash = 'test-book-hash';
    const payloadHash = 'shared-payload';

    mockDb.rows.set(makeRowKey(bookHash, 'note-1'), {
      book_hash: bookHash,
      note_id: 'note-1',
      hardcover_journal_id: 101,
      payload_hash: payloadHash,
      synced_at: 1000,
    });
    mockDb.rows.set(makeRowKey(bookHash, 'note-2'), {
      book_hash: bookHash,
      note_id: 'note-2',
      hardcover_journal_id: 102,
      payload_hash: payloadHash,
      synced_at: 2000,
    });

    const result = await store.getMappingByPayloadHash(bookHash, payloadHash);
    expect(result?.note_id).toBe('note-2');
  });

  test('clearForBook drops the mappings for that book only, including cached ones', async () => {
    const row = (bookHash: string, noteId: string): HardcoverSyncMapRow => ({
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 1,
      payload_hash: 'p',
      synced_at: 1,
    });
    mockDb.rows.set(makeRowKey('book-a', 'note-1'), row('book-a', 'note-1'));
    mockDb.rows.set(makeRowKey('book-b', 'note-1'), row('book-b', 'note-1'));
    // Warm the in-memory cache so a stale entry can't survive the clear.
    expect(await store.getMapping('book-a', 'note-1')).not.toBeNull();

    await store.clearForBook('book-a');

    expect(await store.getMapping('book-a', 'note-1')).toBeNull();
    expect(mockDb.rows.has(makeRowKey('book-a', 'note-1'))).toBe(false);
    expect(await store.getMapping('book-b', 'note-1')).not.toBeNull();
  });

  test.each([
    'legacy-note',
    'note:with:colon',
  ])('migrates legacy localStorage entry for %s into the database on load', async (noteId) => {
    const bookHash = 'legacy-book';
    const legacyRow: HardcoverSyncMapRow = {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 999,
      payload_hash: 'legacy-hash',
      synced_at: 12345,
    };
    const legacyKey = `hardcover-note-mapping:${bookHash}:${noteId}`;
    window.localStorage.setItem(legacyKey, JSON.stringify(legacyRow));

    // Untouched entries for other books should be left alone
    const otherKey = `hardcover-note-mapping:other-book:other-note`;
    window.localStorage.setItem(
      otherKey,
      JSON.stringify({ ...legacyRow, book_hash: 'other-book' }),
    );

    await store.loadForBook(bookHash);

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hardcover_note_mappings'),
      [bookHash, noteId, 999, 'legacy-hash', 12345],
    );
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(window.localStorage.getItem(otherKey)).not.toBeNull();

    const result = await store.getMapping(bookHash, noteId);
    expect(result).toEqual(legacyRow);
  });

  test.each([
    { bookHash: 'other-book', noteId: 'legacy-note' },
    { bookHash: 'legacy-book', noteId: 'other-note' },
  ])('preserves conflicting legacy identity $bookHash/$noteId without writing', async (identity) => {
    const bookHash = 'legacy-book';
    const key = `hardcover-note-mapping:${bookHash}:legacy-note`;
    const existing: HardcoverSyncMapRow = {
      book_hash: identity.bookHash,
      note_id: identity.noteId,
      hardcover_journal_id: 111,
      payload_hash: 'existing-payload',
      synced_at: 1,
    };
    const rowKey = makeRowKey(identity.bookHash, identity.noteId);
    mockDb.rows.set(rowKey, existing);
    const raw = JSON.stringify({ ...existing, hardcover_journal_id: 999 });
    window.localStorage.setItem(key, raw);

    const outcome = await store.loadForBook(bookHash).then(
      () => null,
      (error: unknown) => error,
    );

    expect(mockDb.rows.get(rowKey)).toEqual(existing);
    expect(window.localStorage.getItem(key)).toBe(raw);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/identity/);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.close).toHaveBeenCalledOnce();
    await expect(store.getMapping(bookHash, 'legacy-note')).rejects.toThrow(/identity/);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  test('retains a legacy mapping after a failed write and retries on the same store', async () => {
    const bookHash = 'legacy-book';
    const noteId = 'legacy-note';
    const row: HardcoverSyncMapRow = {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 999,
      payload_hash: 'legacy-hash',
      synced_at: 12345,
    };
    const key = `hardcover-note-mapping:${bookHash}:${noteId}`;
    const raw = JSON.stringify(row);
    window.localStorage.setItem(key, raw);
    const error = new Error('database write failed');
    mockDb.execute.mockRejectedValueOnce(error);

    await expect(store.loadForBook(bookHash)).rejects.toThrow(error);
    expect(window.localStorage.getItem(key)).toBe(raw);
    expect(mockDb.rows.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.close).toHaveBeenCalledTimes(1);

    expect(await store.getMapping(bookHash, noteId)).toEqual(row);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(mockDb.rows.get(makeRowKey(bookHash, noteId))).toEqual(row);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);

    const freshStore = new HardcoverSyncMapStore(mockAppService);
    expect(await freshStore.getMapping(bookHash, noteId)).toEqual(row);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  test('preserves failed and unattempted rows when migration fails partway through', async () => {
    const bookHash = 'legacy-book';
    const rows = ['note-1', 'note-2', 'note-3'].map((noteId, index) => ({
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: index + 1,
      payload_hash: `payload-${index}`,
      synced_at: index,
    }));
    const keys = rows.map((row) => `hardcover-note-mapping:${bookHash}:${row.note_id}`);
    rows.forEach((row, index) => window.localStorage.setItem(keys[index]!, JSON.stringify(row)));
    const execute = mockDb.execute.getMockImplementation()!;
    mockDb.execute.mockImplementationOnce(execute).mockRejectedValueOnce(new Error('write failed'));

    await expect(store.loadForBook(bookHash)).rejects.toThrow('write failed');
    expect(window.localStorage.getItem(keys[0]!)).toBeNull();
    expect(window.localStorage.getItem(keys[1]!)).toBe(JSON.stringify(rows[1]));
    expect(window.localStorage.getItem(keys[2]!)).toBe(JSON.stringify(rows[2]));
    expect(mockDb.rows.size).toBe(1);

    await store.loadForBook(bookHash);
    expect(mockDb.rows.size).toBe(3);
    expect(window.localStorage.length).toBe(0);
    for (const row of rows) {
      expect(await store.getMapping(bookHash, row.note_id)).toEqual(row);
    }
    expect(mockDb.execute).toHaveBeenCalledTimes(4);
  });

  test.each([
    '{bad json',
    'null',
    '[]',
    '{}',
    '42',
    '"text"',
    '{"book_hash":"legacy-book","note_id":"bad-note","hardcover_journal_id":"123","payload_hash":"payload","synced_at":1}',
    '{"book_hash":"legacy-book","note_id":"bad-note","hardcover_journal_id":123,"payload_hash":"payload","synced_at":"yesterday"}',
  ])('discards invalid legacy data %s while migrating other entries', async (raw) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badKey = 'hardcover-note-mapping:legacy-book:bad-note';
    const goodKey = 'hardcover-note-mapping:legacy-book:good-note';
    const row: HardcoverSyncMapRow = {
      book_hash: 'legacy-book',
      note_id: 'good-note',
      hardcover_journal_id: 123,
      payload_hash: 'payload',
      synced_at: 1,
    };
    window.localStorage.setItem(badKey, raw);
    window.localStorage.setItem(goodKey, JSON.stringify(row));
    try {
      await store.loadForBook('legacy-book');
      expect(errorLog).toHaveBeenCalledOnce();
      expect(window.localStorage.getItem(badKey)).toBeNull();
      expect(window.localStorage.getItem(goodKey)).toBeNull();
      expect(await store.getMapping('legacy-book', 'good-note')).toEqual(row);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  test('legacy migration is skipped when window.localStorage is unavailable', async () => {
    vi.stubGlobal('window', {});

    await store.loadForBook('book-1');

    // Only the SELECT for loading should have run; no INSERTs from migration.
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});
