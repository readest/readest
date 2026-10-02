import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';

/**
 * #5910: the reader's sync row read ONLY Readest Cloud's per-book stamps, so a
 * user syncing exclusively through WebDAV / iCloud / Drive / S3 was told "Never
 * synced" — or, with no Readest account at all, "Sign in to Sync" — while their
 * sync was working perfectly. This hook is the shared answer to "is my sync
 * healthy?" for both the reader View menu and the library Settings menu.
 */

let mockUser: { id: string } | null = null;
let mockSettings: Partial<SystemSettings> = {};
let mockByKind: Record<string, { isSyncing: boolean }> = {};
let mockLastError: Record<string, string | null> = {};
let mockHardcover: Record<string, { pending: number; lastError: string | null }> = {};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, vars?: Record<string, unknown>): string =>
      vars ? `${key}|${JSON.stringify(vars)}` : key,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Partial<SystemSettings> }) => unknown) =>
    selector({ settings: mockSettings }),
}));
vi.mock('@/store/fileSyncStore', () => ({
  useFileSyncStore: (
    selector: (s: { byKind: unknown; lastErrorByKind: unknown }) => unknown,
  ): unknown => selector({ byKind: mockByKind, lastErrorByKind: mockLastError }),
}));
vi.mock('@/store/hardcoverSyncStore', () => ({
  useHardcoverSyncStore: (selector: (s: { byBook: typeof mockHardcover }) => unknown): unknown =>
    selector({ byBook: mockHardcover }),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({
  getReadyFileSyncBackends: (settings: Partial<SystemSettings>) => {
    const ready: string[] = [];
    if (settings?.webdav?.enabled) ready.push('webdav');
    if (settings?.icloud?.enabled) ready.push('icloud');
    return ready;
  },
}));

const { useCloudSyncStatus } = await import('@/hooks/useCloudSyncStatus');

const NOW = 1_700_000_000_000;

beforeEach(() => {
  mockUser = null;
  mockSettings = {};
  mockByKind = {};
  mockLastError = {};
  mockHardcover = {};
  vi.setSystemTime(NOW);
});

describe('useCloudSyncStatus (issue #5910)', () => {
  it('reports a third-party backend as synced with no Readest account', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.needsSignIn).toBe(false);
    expect(result.current.label).toContain('Synced {{time}}');
    expect(result.current.lastSyncedAt).toBe(NOW - 60_000);
    expect(result.current.providers.map((p) => p.kind)).toEqual(['webdav']);
  });

  it('still asks for sign-in when Readest Cloud is the only provider', () => {
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.needsSignIn).toBe(true);
    expect(result.current.label).toBe('Sign in to Sync');
  });

  it('ignores the native stamp when Readest Cloud is switched off', () => {
    // The native cursors FREEZE rather than reset when the channels are gated,
    // so a stale value would report a disabled provider as recently synced.
    mockUser = { id: 'u1' };
    mockSettings = {
      readestCloud: { enabled: false },
      webdav: { enabled: true },
    } as never;
    const { result } = renderHook(() => useCloudSyncStatus(NOW - 5_000));

    expect(result.current.providers.map((p) => p.kind)).toEqual(['webdav']);
    expect(result.current.lastSyncedAt).toBe(0);
    expect(result.current.label).toBe('Never synced');
  });

  it('lists both providers with their own timestamps', () => {
    mockUser = { id: 'u1' };
    mockSettings = {
      readestCloud: { enabled: true },
      webdav: { enabled: true, lastSyncedAt: NOW - 120_000 },
    } as never;
    const { result } = renderHook(() => useCloudSyncStatus(NOW - 300_000));

    expect(result.current.providers).toEqual([
      expect.objectContaining({ kind: 'readest', lastSyncedAt: NOW - 300_000 }),
      expect.objectContaining({ kind: 'webdav', lastSyncedAt: NOW - 120_000 }),
    ]);
    // The row shows the freshest; the per-provider breakdown is the dialog's job.
    expect(result.current.lastSyncedAt).toBe(NOW - 120_000);
  });

  it('reports an in-flight backend run', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    mockByKind = { webdav: { isSyncing: true } };
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.syncing).toBe(true);
    expect(result.current.label).toBe('Syncing…');
  });

  it('reports a backend whose last run failed, over a stale success', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    mockLastError = { webdav: 'ETIMEDOUT' };
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.failed).toBe(true);
    expect(result.current.label).toBe('Sync failed');
  });

  it('drops a backend that cannot run right now', () => {
    // An expired web Google Drive token is still `enabled` but silently
    // skipped, so it must not lend its stale lastSyncedAt to "Synced X ago".
    // Selecting Drive also switches Readest Cloud off, so nothing can sync —
    // and "Sign in to Sync" would be a lie, because signing in would not help.
    // Drive's own settings row carries the Reconnect CTA.
    mockSettings = { googleDrive: { enabled: true, lastSyncedAt: NOW - 1_000 } } as never;
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.providers).toEqual([]);
    expect(result.current.lastSyncedAt).toBe(0);
    expect(result.current.needsSignIn).toBe(false);
    expect(result.current.label).toBe('Never synced');
  });
});

describe('useCloudSyncStatus Hardcover (book scope)', () => {
  const hardcover = (over = {}) =>
    ({
      readestCloud: { enabled: false },
      hardcover: {
        enabled: true,
        autoSync: true,
        accessToken: 'tok',
        lastSyncedAt: NOW - 60_000,
        ...over,
      },
    }) as never;

  it('is a book-scope provider only, with its own timestamp', () => {
    mockSettings = hardcover();

    const library = renderHook(() => useCloudSyncStatus(0)).result.current;
    expect(library.providers).toEqual([]);
    expect(library.label).toBe('Never synced');

    const book = renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current;
    expect(book.providers).toEqual([
      expect.objectContaining({ kind: 'hardcover', name: 'Hardcover', lastSyncedAt: NOW - 60_000 }),
    ]);
    expect(book.label).toContain('Synced {{time}}');
  });

  it('is a provider with Auto Sync off, since the row push is a manual sync', () => {
    mockSettings = hardcover({ autoSync: false });
    const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));
    expect(result.current.providers.map((p) => p.kind)).toEqual(['hardcover']);
  });

  it('is omitted when disconnected or missing a token', () => {
    for (const over of [{ enabled: false }, { accessToken: '' }]) {
      mockSettings = hardcover(over);
      const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));
      expect(result.current.providers).toEqual([]);
    }
  });

  it("reports this book's in-flight and failed pushes, not another book's", () => {
    mockSettings = hardcover();
    mockHardcover = { 'book-a': { pending: 1, lastError: null } };
    expect(renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current.label).toBe('Syncing…');

    mockHardcover = { 'book-a': { pending: 0, lastError: 'boom' } };
    const a = renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current;
    expect(a.failed).toBe(true);
    expect(a.label).toBe('Sync failed');

    const b = renderHook(() => useCloudSyncStatus(0, 'book-b')).result.current;
    expect(b.failed).toBe(false);
    expect(b.label).toContain('Synced {{time}}');
  });

  it('does not send a signed-out user to login when Hardcover can still sync', () => {
    mockSettings = { hardcover: { enabled: true, autoSync: true, accessToken: 'tok' } } as never;
    const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));

    expect(result.current.providers.map((p) => p.kind)).toEqual(['readest', 'hardcover']);
    expect(result.current.needsSignIn).toBe(false);
  });
});
