import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const gateMock = vi.fn();
vi.mock('@/services/sync/cloudSyncProvider', async (orig) => ({
  ...(await orig<typeof import('@/services/sync/cloudSyncProvider')>()),
  resolveCloudSyncGate: (...a: unknown[]) => gateMock(...a),
}));
const createProviderMock = vi.fn();
vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: (...a: unknown[]) => createProviderMock(...a),
}));
const getUserIDMock = vi.fn();
vi.mock('@/utils/access', async (orig) => ({
  ...(await orig<typeof import('@/utils/access')>()),
  getUserID: () => getUserIDMock(),
}));

import { getBookDataDestinations } from '@/services/sync/bookData/destinationsFor';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';

const appService = {} as AppService;
const ids = async () => (await getBookDataDestinations(appService, 'h')).map((d) => d.id);

const setSettings = (patch: Partial<SystemSettings>) =>
  useSettingsStore.setState({ settings: { ...patch } as SystemSettings });
const setBook = (book: Partial<Book> | null) =>
  useLibraryStore.setState({
    library: book ? ([{ hash: 'h', title: 'T', ...book }] as Book[]) : [],
    hashIndex: new Map(book ? [['h', 0]] : []),
  });

beforeEach(() => {
  gateMock.mockReset().mockReturnValue({ readest: false, backends: [], paused: false });
  createProviderMock
    .mockReset()
    .mockImplementation(async (kind: string) => ({ rootPath: '/', kind }));
  getUserIDMock.mockReset().mockResolvedValue('u1');
  setSettings({});
  setBook({ uploadedAt: 1 });
});
afterEach(() => setBook(null));

describe('getBookDataDestinations', () => {
  test('returns every enabled, unpaused file-sync backend', async () => {
    gateMock.mockReturnValue({ readest: false, backends: ['webdav', 'gdrive'], paused: false });
    expect(await ids()).toEqual(['webdav', 'gdrive']);
  });

  test('skips a backend whose provider cannot be built', async () => {
    gateMock.mockReturnValue({ readest: false, backends: ['webdav', 'gdrive'], paused: false });
    createProviderMock.mockImplementation(async (kind: string) =>
      kind === 'webdav' ? null : { rootPath: '/' },
    );
    expect(await ids()).toEqual(['gdrive']);
  });

  test('returns none while backends are paused', async () => {
    gateMock.mockReturnValue({ readest: false, backends: ['webdav'], paused: true });
    expect(await ids()).toEqual([]);
  });

  test('adds Readest Cloud for an uploaded book', async () => {
    gateMock.mockReturnValue({ readest: true, backends: ['webdav'], paused: false });
    setSettings({ readestCloud: { enabled: true } } as Partial<SystemSettings>);
    expect(await ids()).toEqual(['readest', 'webdav']);
  });

  test('skips Readest Cloud for a book that is not uploaded', async () => {
    gateMock.mockReturnValue({ readest: true, backends: [], paused: false });
    setSettings({ readestCloud: { enabled: true } } as Partial<SystemSettings>);
    setBook({ uploadedAt: null });
    expect(await ids()).toEqual([]);
  });

  test('skips Readest Cloud with the Books category off', async () => {
    gateMock.mockReturnValue({ readest: true, backends: [], paused: false });
    setSettings({
      readestCloud: { enabled: true },
      syncCategories: { book: false },
    } as Partial<SystemSettings>);
    expect(await ids()).toEqual([]);
  });

  test('skips Readest Cloud when signed out', async () => {
    gateMock.mockReturnValue({ readest: true, backends: [], paused: false });
    setSettings({ readestCloud: { enabled: true } } as Partial<SystemSettings>);
    getUserIDMock.mockResolvedValue(null);
    expect(await ids()).toEqual([]);
  });

  test('returns none when Book Data is off', async () => {
    gateMock.mockReturnValue({ readest: true, backends: ['webdav'], paused: false });
    setSettings({
      readestCloud: { enabled: true },
      syncCategories: { book_data: false },
    } as Partial<SystemSettings>);
    expect(await ids()).toEqual([]);
    expect(createProviderMock).not.toHaveBeenCalled();
  });
});
