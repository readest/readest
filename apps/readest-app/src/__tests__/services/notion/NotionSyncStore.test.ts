import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NotionSyncStore } from '@/services/notion/NotionSyncStore';
import type { AppService } from '@/types/system';

type PageRow = {
  target_id: string;
  book_hash: string;
  page_id: string;
  title: string;
};

type NoteRow = {
  target_id: string;
  book_hash: string;
  note_id: string;
  payload_hash: string;
  block_ids: string;
  stale_block_ids: string;
  synced_at: number;
};

describe('NotionSyncStore', () => {
  const pages = new Map<string, PageRow>();
  const notes = new Map<string, NoteRow>();
  const key = (...parts: string[]) => parts.join('\0');
  const database = {
    select: vi.fn(async (sql: string, parameters: unknown[] = []) => {
      if (/FROM notion_book_pages/i.test(sql)) {
        return [pages.get(key(parameters[0] as string, parameters[1] as string))].filter(Boolean);
      }
      if (/FROM notion_note_mappings/i.test(sql)) {
        return [
          notes.get(key(parameters[0] as string, parameters[1] as string, parameters[2] as string)),
        ].filter(Boolean);
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, parameters: unknown[] = []) => {
      if (/INSERT INTO notion_book_pages/i.test(sql)) {
        const [target_id, book_hash, page_id, title] = parameters as [
          string,
          string,
          string,
          string,
        ];
        pages.set(key(target_id, book_hash), { target_id, book_hash, page_id, title });
      }
      if (/INSERT INTO notion_note_mappings/i.test(sql)) {
        const [target_id, book_hash, note_id, payload_hash, block_ids, stale_block_ids, synced_at] =
          parameters as [string, string, string, string, string, string, number];
        notes.set(key(target_id, book_hash, note_id), {
          target_id,
          book_hash,
          note_id,
          payload_hash,
          block_ids,
          stale_block_ids,
          synced_at,
        });
      }
      return {};
    }),
    close: vi.fn(async () => {}),
  };
  const appService = {
    openDatabase: vi.fn(async () => database),
  } as unknown as AppService;

  beforeEach(() => {
    pages.clear();
    notes.clear();
    vi.clearAllMocks();
  });

  test('persists page and note identities in the dedicated database', async () => {
    const store = new NotionSyncStore(appService);
    await store.setPageMapping({
      targetId: 'target',
      bookHash: 'book',
      pageId: 'page',
      title: 'Title',
    });
    await store.setNoteMapping({
      targetId: 'target',
      bookHash: 'book',
      noteId: 'note',
      payloadHash: 'hash',
      blockIds: ['new-1'],
      staleBlockIds: ['old-1'],
    });

    await expect(store.getPageMapping('target', 'book')).resolves.toEqual({
      targetId: 'target',
      bookHash: 'book',
      pageId: 'page',
      title: 'Title',
    });
    await expect(store.getNoteMapping('target', 'book', 'note')).resolves.toEqual({
      targetId: 'target',
      bookHash: 'book',
      noteId: 'note',
      payloadHash: 'hash',
      blockIds: ['new-1'],
      staleBlockIds: ['old-1'],
    });
    expect(appService.openDatabase).toHaveBeenCalledWith('notion-sync', 'notion-sync.db', 'Data');
    expect(appService.openDatabase).toHaveBeenCalledTimes(1);
    await store.close();
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  test('treats malformed persisted block-id arrays as empty', async () => {
    notes.set(key('target', 'book', 'note'), {
      target_id: 'target',
      book_hash: 'book',
      note_id: 'note',
      payload_hash: 'hash',
      block_ids: 'not-json',
      stale_block_ids: '[1,"valid"]',
      synced_at: 1,
    });

    await expect(
      new NotionSyncStore(appService).getNoteMapping('target', 'book', 'note'),
    ).resolves.toEqual(
      expect.objectContaining({
        blockIds: [],
        staleBlockIds: ['valid'],
      }),
    );
  });
});
