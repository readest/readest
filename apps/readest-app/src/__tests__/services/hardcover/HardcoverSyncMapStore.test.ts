import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HardcoverSyncMapStore } from '@/services/hardcover/HardcoverSyncMapStore';
import type { AppService } from '@/types/system';

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

describe('HardcoverSyncMapStore', () => {
  let mockAppService: AppService;
  let mockDb: MockDb;
  let store: HardcoverSyncMapStore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Database
    mockDb = {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue({}),
    };

    // Mock AppService
    mockAppService = {
      openDatabase: vi.fn().mockResolvedValue(mockDb),
    } as unknown as AppService;

    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value.toString();
        }),
        key: vi.fn((index: number) => Object.keys(store)[index] || null),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          store = {};
        }),
        get length() {
          return Object.keys(store).length;
        },
      };
    })();

    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', { localStorage: localStorageMock });

    store = new HardcoverSyncMapStore(mockAppService);
  });

  test('should load from localStorage on web', async () => {
    const bookHash = 'test-book-hash';
    const noteId = 'note-1';
    const mapping = {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 123,
      payload_hash: 'abc',
      synced_at: Date.now(),
    };

    window.localStorage.setItem(
      `hardcover-note-mapping:${bookHash}:${noteId}`,
      JSON.stringify(mapping),
    );

    await store.loadForBook(bookHash);
    const result = await store.getMapping(bookHash, noteId);

    expect(result).toEqual(mapping);
    expect(mockAppService.openDatabase).not.toHaveBeenCalled();
  });

  test('should load from SQLite on native', async () => {
    // Force native path by removing window.localStorage
    vi.stubGlobal('window', {});

    const bookHash = 'test-book-hash';
    const noteId = 'note-1';
    const mapping = {
      book_hash: bookHash,
      note_id: noteId,
      hardcover_journal_id: 123,
      payload_hash: 'abc',
      synced_at: Date.now(),
    };

    mockDb.select.mockResolvedValueOnce([mapping]);

    await store.loadForBook(bookHash);
    const result = await store.getMapping(bookHash, noteId);

    expect(result).toEqual(mapping);
    expect(mockAppService.openDatabase).toHaveBeenCalledWith(
      'hardcover-sync',
      'hardcover-sync.db',
      'Data',
    );
  });

  test('upsertMapping should mark as modified and flush should save to localStorage', async () => {
    const bookHash = 'test-book-hash';
    const noteId = 'note-1';

    await store.upsertMapping(bookHash, noteId, 456, 'def');
    await store.flush();

    const stored = JSON.parse(
      window.localStorage.getItem(`hardcover-note-mapping:${bookHash}:${noteId}`)!,
    );
    expect(stored.hardcover_journal_id).toBe(456);
    expect(stored.payload_hash).toBe('def');
  });

  test('flush should persist mappings to SQLite on native', async () => {
    vi.stubGlobal('window', {});

    const bookHash = 'test-book-hash';
    const noteId = 'note-1';

    await store.upsertMapping(bookHash, noteId, 456, 'def');
    await store.flush();

    expect(mockAppService.openDatabase).toHaveBeenCalledWith(
      'hardcover-sync',
      'hardcover-sync.db',
      'Data',
    );
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hardcover_note_mappings'),
      expect.arrayContaining([bookHash, noteId, 456, 'def']),
    );
  });

  test('getMappingByPayloadHash should return the latest mapping', async () => {
    const bookHash = 'test-book-hash';
    const payloadHash = 'shared-payload';

    const mapping1 = {
      book_hash: bookHash,
      note_id: 'note-1',
      hardcover_journal_id: 101,
      payload_hash: payloadHash,
      synced_at: 1000,
    };
    const mapping2 = {
      book_hash: bookHash,
      note_id: 'note-2',
      hardcover_journal_id: 102,
      payload_hash: payloadHash,
      synced_at: 2000,
    };

    window.localStorage.setItem(
      `hardcover-note-mapping:${bookHash}:note-1`,
      JSON.stringify(mapping1),
    );
    window.localStorage.setItem(
      `hardcover-note-mapping:${bookHash}:note-2`,
      JSON.stringify(mapping2),
    );

    const result = await store.getMappingByPayloadHash(bookHash, payloadHash);
    expect(result!.note_id).toBe('note-2');
  });
});
