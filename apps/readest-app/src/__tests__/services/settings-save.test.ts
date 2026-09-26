import { beforeEach, describe, expect, it } from 'vitest';
import { hlcPack } from '@/libs/crdt';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { DEFAULT_SYSTEM_SETTINGS, SETTINGS_FILENAME } from '@/services/constants';
import { saveSettings } from '@/services/settingsService';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

const SHELF_A = '00000000-0000-4000-8000-00000000000a';

const shelfRow = (id: string, name: string, ms: number, userId = 'account'): ReplicaRow => {
  const t = hlcPack(ms, 0, 'device') as Hlc;
  return {
    user_id: userId,
    kind: 'bookshelf',
    replica_id: id,
    fields_jsonb: { definition: { v: createBookshelf(name, id), t, s: 'device' } },
    updated_at_ts: t,
    deleted_at_ts: null,
    manifest_jsonb: null,
    reincarnation: null,
    schema_version: 1,
  };
};

const makeFs = () => {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let failNextWrite = false;
  const fs = {
    readFile: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    writeFile: async (path: string, _base: unknown, content: string) => {
      if (path === SETTINGS_FILENAME) {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error('disk full');
        }
        writes.push(content);
      }
      files.set(path, content);
    },
    getPrefix: async () => 'Books',
  } as unknown as FileSystem;
  return {
    fs,
    files,
    writes,
    failNextWrite: () => {
      failNextWrite = true;
    },
  };
};

const settingsWith = (deviceId: string, bookshelves?: SystemSettings['bookshelves']) =>
  ({
    ...DEFAULT_SYSTEM_SETTINGS,
    replicaDeviceId: deviceId,
    ...(bookshelves ? { bookshelves } : {}),
  }) as SystemSettings;

beforeEach(() => {
  localStorage.clear();
});

describe('saveSettings', () => {
  it('keeps a bookshelf row that another window already wrote to disk', async () => {
    const { fs, writes } = makeFs();
    const newer = shelfRow(SHELF_A, 'From the other window', 2000);
    await saveSettings(fs, settingsWith('other', { rows: { [SHELF_A]: newer } }));
    writes.length = 0;

    await saveSettings(
      fs,
      settingsWith('device', { rows: { [SHELF_A]: shelfRow(SHELF_A, 'Stale', 1000) } }),
    );

    const written = JSON.parse(writes.at(-1)!) as SystemSettings;
    expect(written.bookshelves!.rows[SHELF_A]!.fields_jsonb['definition']!.v).toMatchObject({
      name: 'From the other window',
    });
  });

  it('writes even when settings.json is missing', async () => {
    const { fs, files, writes } = makeFs();

    await saveSettings(fs, settingsWith('device'));

    expect(writes).toHaveLength(1);
    expect(JSON.parse(files.get(SETTINGS_FILENAME)!).replicaDeviceId).toBe('device');
  });

  it('coalesces a burst of saves into fewer read/write cycles', async () => {
    const { fs, files, writes } = makeFs();

    await Promise.all([
      saveSettings(fs, settingsWith('d1')),
      saveSettings(fs, settingsWith('d2')),
      saveSettings(fs, settingsWith('d3')),
    ]);

    expect(writes.length).toBeLessThan(3);
    expect(JSON.parse(files.get(SETTINGS_FILENAME)!).replicaDeviceId).toBe('d3');
  });

  it('rejects the caller whose write failed and still lands the queued data', async () => {
    const { fs, files, writes, failNextWrite } = makeFs();
    // A readable file on disk keeps safeLoadJSON off its backup-restore path,
    // so `writes` counts only the writes this save path issues.
    files.set(SETTINGS_FILENAME, '{}');
    failNextWrite();

    const first = saveSettings(fs, settingsWith('d1'));
    const second = saveSettings(fs, settingsWith('d2'));

    await expect(first).rejects.toThrow(/settings.json/);
    await second;

    expect(writes).toHaveLength(1);
    expect(JSON.parse(files.get(SETTINGS_FILENAME)!).replicaDeviceId).toBe('d2');

    await saveSettings(fs, settingsWith('d3'));
    expect(JSON.parse(files.get(SETTINGS_FILENAME)!).replicaDeviceId).toBe('d3');
  });
});
