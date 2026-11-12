// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { GrimmorySyncStore } from '@/services/grimmory/GrimmorySyncStore';
import type { GrimmoryNoteLink } from '@/services/grimmory/notesSync';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

/**
 * Like the native turso plugin: one connection per path, shared by every
 * open, and gone for everyone once any caller closes it.
 */
const sharedConnection = (db: DatabaseService) => {
  const state = { loaded: false, failInsertAt: 0, inserts: 0 };
  const check = () => {
    if (!state.loaded) throw new Error('database not loaded');
  };
  const handle: DatabaseService = {
    execute: async (sql, params) => {
      check();
      if (sql.trim().startsWith('INSERT') && ++state.inserts === state.failInsertAt) {
        throw new Error('disk I/O error');
      }
      return db.execute(sql, params);
    },
    select: async (sql, params) => {
      check();
      return db.select(sql, params);
    },
    batch: (statements) => db.batch(statements),
    close: async () => {
      state.loaded = false;
    },
  };
  const appService = {
    openDatabase: async () => {
      await Promise.resolve();
      state.loaded = true;
      return handle;
    },
  } as unknown as AppService;
  return { state, appService };
};

const link = (noteId: string, serverId: number): GrimmoryNoteLink => ({
  noteId,
  kind: 'annotation',
  serverId,
  localUpdatedAt: 1000,
});

describe('GrimmorySyncStore', () => {
  let conn: ReturnType<typeof sharedConnection>;
  let store: GrimmorySyncStore;
  beforeEach(async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('grimmory-sync'));
    conn = sharedConnection(db);
    store = new GrimmorySyncStore(conn.appService);
  });

  test('a failed link write leaves the previous links in place', async () => {
    await store.setLinks('acct', 'hash', 'annotation', [link('n1', 1), link('n2', 2)]);
    conn.state.inserts = 0;
    conn.state.failInsertAt = 2;
    await expect(
      store.setLinks('acct', 'hash', 'annotation', [link('n1', 1), link('n3', 3)]),
    ).rejects.toThrow('disk I/O error');
    expect((await store.getLinks('acct', 'hash')).map((l) => l.noteId).sort()).toEqual([
      'n1',
      'n2',
    ]);
  });

  test('calls at the same time do not close the connection under each other', async () => {
    const results = await Promise.allSettled([
      store.setLinks('acct', 'hash', 'annotation', [link('n1', 1), link('n2', 2)]),
      store.getBooks('acct'),
      store.getLinks('acct', 'hash'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
  });
});
