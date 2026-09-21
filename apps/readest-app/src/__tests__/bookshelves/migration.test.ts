import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, type Context } from '@/services/settingsService';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { defaultBookshelves, createBookshelf } from '@/services/bookshelves/definitions';
import {
  applyBookshelfDraft,
  mergeBookshelfStates,
  readBookshelves,
} from '@/services/bookshelves/state';
import { journalBookshelfOperation, readPendingBookshelves } from '@/services/bookshelves/journal';
import { bookshelfReplicaSchema } from '@/services/bookshelves/replica';
import { HlcGenerator } from '@/libs/crdt';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

const disk = vi.hoisted(() => ({
  settings: undefined as Partial<SystemSettings> | undefined,
  save: vi.fn(),
}));
vi.mock('@/services/persistence', () => ({
  safeLoadJSON: async (_fs: unknown, _name: string, _base: string, fallback: unknown) =>
    structuredClone(disk.settings ?? fallback),
  safeSaveJSON: async (_fs: unknown, _name: string, _base: string, settings: SystemSettings) => {
    await disk.save(settings);
    disk.settings = structuredClone(settings);
  },
}));
const ctx: Context = {
  fs: { getPrefix: async () => '/books' } as unknown as FileSystem,
  isMobile: false,
  isEink: false,
  isAppDataSandbox: false,
};
beforeEach(() => {
  localStorage.clear();
  disk.save.mockReset().mockResolvedValue(undefined);
  disk.settings = {
    ...structuredClone(DEFAULT_SYSTEM_SETTINGS),
    replicaDeviceId: 'device',
    kosync: { ...DEFAULT_SYSTEM_SETTINGS.kosync!, deviceId: 'kosync' },
    bookorbit: { ...DEFAULT_SYSTEM_SETTINGS.bookorbit!, deviceId: 'bookorbit' },
  };
});
afterEach(() => localStorage.clear());

describe('one-time bookshelf settings migration', () => {
  for (const recent of [false, true]) {
    for (const hide of [false, true]) {
      for (const fit of ['crop', 'fit'] as const) {
        for (const skeuomorphic of [false, true]) {
          it(`persists recent=${recent}, hide=${hide}, fit=${fit}, skeuomorphic=${skeuomorphic}`, async () => {
            Object.assign(disk.settings!, {
              libraryRecentShelfEnabled: recent,
              libraryHideCovers: hide,
              libraryCoverFit: fit,
              librarySkeuomorphicCovers: skeuomorphic,
            });
            const settings = await loadSettings(ctx);
            expect(settings.bookshelves?.legacySettingsMigrated).toBe(true);
            expect(disk.settings?.bookshelves).toEqual(settings.bookshelves);
            expect(disk.save).toHaveBeenCalledOnce();
            const rows = Object.values(settings.bookshelves!.rows);
            expect(rows).toHaveLength(defaultBookshelves({}).length);
            for (const row of rows) {
              expect(bookshelfReplicaSchema.safeParse(row).success).toBe(true);
              expect(row.fields_jsonb['definition']!.v).toMatchObject({
                hideCovers: hide,
                coverFit: fit,
                skeuomorphicCovers: skeuomorphic,
              });
            }
            expect(readBookshelves(settings).find((s) => s.id === 'recent')?.enabled).toBe(recent);
          });
        }
      }
    }
  }

  it('uses the previous defaults when an older config has no library flags', async () => {
    for (const key of [
      'libraryRecentShelfEnabled',
      'libraryHideCovers',
      'libraryCoverFit',
      'librarySkeuomorphicCovers',
    ] as const)
      delete disk.settings![key];
    const settings = await loadSettings(ctx);
    expect(settings.bookshelves?.legacySettingsMigrated).toBe(true);
    expect(readBookshelves(settings).find((s) => s.id === 'recent')).toMatchObject({
      enabled: false,
      hideCovers: false,
      coverFit: 'crop',
      skeuomorphicCovers: false,
    });
  });

  it('does not reapply legacy preferences after a restart', async () => {
    Object.assign(disk.settings!, {
      libraryRecentShelfEnabled: true,
      libraryHideCovers: true,
      libraryCoverFit: 'fit',
      librarySkeuomorphicCovers: true,
    });
    const first = await loadSettings(ctx);
    Object.assign(disk.settings!, {
      libraryRecentShelfEnabled: false,
      libraryHideCovers: false,
      libraryCoverFit: 'crop',
      librarySkeuomorphicCovers: false,
    });
    disk.save.mockClear();
    const second = await loadSettings(ctx);
    expect(second.bookshelves).toEqual(first.bookshelves);
    expect(readBookshelves(second)).toEqual(readBookshelves(first));
    expect(disk.save).not.toHaveBeenCalled();
  });

  it('preserves existing shelf definitions, order, and pending edits', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'account' }));
    const base = defaultBookshelves(disk.settings!);
    const custom = createBookshelf('My shelf');
    const recent = {
      ...base.find((s) => s.id === 'recent')!,
      enabled: true,
      name: 'Reading now',
      coverFit: 'fit' as const,
    };
    const clock = new HlcGenerator('other-device');
    const changed = applyBookshelfDraft(
      { rows: {} },
      base,
      [custom, ...base.map((s) => (s.id === 'recent' ? recent : s))],
      {
        userId: 'account',
        deviceId: 'other-device',
        next: () => clock.next(),
      },
    );
    disk.settings!.bookshelves = changed.state;
    const pending = applyBookshelfDraft(
      changed.state,
      [custom, ...base],
      [custom, ...base.map((s) => (s.id === 'default' ? { ...s, hideCovers: true } : s))],
      {
        userId: 'account',
        deviceId: 'other-device',
        next: () => clock.next(),
      },
    );
    for (const row of pending.operations) journalBookshelfOperation(row);
    const loaded = await loadSettings(ctx);
    expect(loaded.bookshelves?.legacySettingsMigrated).toBe(true);
    const shelves = readBookshelves(loaded);
    expect(shelves[0]).toEqual(custom);
    expect(shelves.find((s) => s.id === 'recent')).toEqual(recent);
    expect(shelves.find((s) => s.id === 'default')?.hideCovers).toBe(true);
    expect(loaded.bookshelves?.rows[recent.id]?.fields_jsonb).toEqual(
      changed.state.rows[recent.id]?.fields_jsonb,
    );
  });

  it('lets existing synced edits win over migration defaults and retains the migration marker', async () => {
    const base = defaultBookshelves(disk.settings!);
    const clock = new HlcGenerator('remote', () => 1000);
    const remote = applyBookshelfDraft(
      { rows: {} },
      base,
      base.map((s) =>
        s.id === 'recent' ? { ...s, enabled: true, name: 'Synced recent', hideCovers: true } : s,
      ),
      {
        userId: 'account',
        deviceId: 'remote',
        next: () => clock.next(),
      },
    ).state;
    const loaded = await loadSettings(ctx);
    disk.settings!.bookshelves = mergeBookshelfStates(loaded.bookshelves, remote);
    disk.save.mockClear();
    const reloaded = await loadSettings(ctx);
    expect(reloaded.bookshelves?.legacySettingsMigrated).toBe(true);
    expect(readBookshelves(reloaded).find((s) => s.id === 'recent')).toMatchObject({
      enabled: true,
      name: 'Synced recent',
      hideCovers: true,
    });
    expect(disk.save).not.toHaveBeenCalled();
  });

  it.each([
    'account-b',
    null,
  ])('recovers only anonymous and current-account edits for %s', async (userId) => {
    if (userId) localStorage.setItem('user', JSON.stringify({ id: userId }));
    const base = defaultBookshelves(disk.settings!);
    const clock = new HlcGenerator('device');
    const shelves = ['account-a', 'account-b', ''].map((owner) => {
      const shelf = createBookshelf(owner || 'Anonymous');
      const { operations } = applyBookshelfDraft({ rows: {} }, base, [...base, shelf], {
        userId: owner,
        deviceId: 'device',
        next: () => clock.next(),
      });
      for (const row of operations) journalBookshelfOperation(row);
      return { owner, shelf };
    });
    const pending = readPendingBookshelves();

    const loaded = readBookshelves(await loadSettings(ctx));

    for (const { owner, shelf } of shelves) {
      expect(loaded.some((entry) => entry.id === shelf.id)).toBe(!owner || owner === userId);
    }
    expect(readPendingBookshelves()).toEqual(pending);
  });

  it('retries migration if saving the config fails', async () => {
    disk.save.mockRejectedValueOnce(new Error('Disk full'));
    await expect(loadSettings(ctx)).rejects.toThrow('Disk full');
    expect(disk.settings?.bookshelves?.legacySettingsMigrated).toBeUndefined();
    await loadSettings(ctx);
    expect(disk.settings?.bookshelves?.legacySettingsMigrated).toBe(true);
    expect(disk.save).toHaveBeenCalledTimes(2);
  });
});
