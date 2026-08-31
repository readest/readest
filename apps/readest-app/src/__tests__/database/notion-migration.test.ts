import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { NotionSyncStore } from '@/services/notion/NotionSyncStore';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

describe('Notion sync migration', () => {
  let database: DatabaseService;

  beforeEach(async () => {
    database = await NodeDatabaseService.open(':memory:');
  });

  afterEach(async () => {
    await database.close();
  });

  test('creates both mapping tables and applies idempotently', async () => {
    const migrations = getMigrations('notion-sync');
    expect(migrations).toHaveLength(1);

    await migrate(database, migrations);
    await migrate(database, migrations);

    const tables = await database.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notion_%'",
    );
    expect(tables.map(({ name }) => name).sort()).toEqual([
      'notion_book_pages',
      'notion_note_mappings',
    ]);
    const version = await database.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]!.user_version).toBe(migrations.length);
  });

  test('supports the real NotionSyncStore queries and composite-key upserts', async () => {
    await migrate(database, getMigrations('notion-sync'));
    const appService = {
      openDatabase: vi.fn(async () => database),
    } as unknown as AppService;
    const store = new NotionSyncStore(appService);

    await store.setPageMapping({
      targetId: 'target-a',
      bookHash: 'book',
      pageId: 'page-a',
      title: 'First title',
    });
    await store.setPageMapping({
      targetId: 'target-b',
      bookHash: 'book',
      pageId: 'page-b',
      title: 'Second target',
    });
    await store.setPageMapping({
      targetId: 'target-a',
      bookHash: 'book',
      pageId: 'page-a-updated',
      title: 'Updated title',
    });
    await store.setNoteMapping({
      targetId: 'target-a',
      bookHash: 'book',
      noteId: 'note',
      payloadHash: 'payload',
      blockIds: ['new-1'],
      staleBlockIds: ['old-1'],
    });

    await expect(store.getPageMapping('target-a', 'book')).resolves.toEqual({
      targetId: 'target-a',
      bookHash: 'book',
      pageId: 'page-a-updated',
      title: 'Updated title',
    });
    await expect(store.getPageMapping('target-b', 'book')).resolves.toEqual({
      targetId: 'target-b',
      bookHash: 'book',
      pageId: 'page-b',
      title: 'Second target',
    });
    await expect(store.getNoteMapping('target-a', 'book', 'note')).resolves.toEqual({
      targetId: 'target-a',
      bookHash: 'book',
      noteId: 'note',
      payloadHash: 'payload',
      blockIds: ['new-1'],
      staleBlockIds: ['old-1'],
    });

    await store.clearBookMappings('target-a', 'book');
    await expect(store.getPageMapping('target-a', 'book')).resolves.toBeNull();
    await expect(store.getNoteMapping('target-a', 'book', 'note')).resolves.toBeNull();
    await expect(store.getPageMapping('target-b', 'book')).resolves.toEqual({
      targetId: 'target-b',
      bookHash: 'book',
      pageId: 'page-b',
      title: 'Second target',
    });
  });
});
