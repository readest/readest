import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import {
  SERVER_CONFIG_STORAGE_KEY,
  type StoredServerConfig,
  readStoredServerConfig,
  writeStoredServerConfig,
} from '@/services/serverConfig';
import {
  resetLibraryForServerSwitch,
  resetSettingsForServerSwitch,
  switchServer,
} from '@/services/serverSwitch';

const book = (hash: string, fields: Partial<Book>): Book =>
  ({ hash, title: hash, format: 'EPUB', createdAt: 1, updatedAt: 1, ...fields }) as Book;

const stored = (serverUrl: string): StoredServerConfig => ({
  v: 1,
  serverUrl,
  config: { supabaseUrl: serverUrl, supabaseAnonKey: 'anon-key', apiBaseUrl: serverUrl },
  savedAt: 1,
});

describe('resetLibraryForServerSwitch', () => {
  it('keeps downloaded books and clears their cloud markers', () => {
    const result = resetLibraryForServerSwitch([
      book('local', { downloadedAt: 5, uploadedAt: 6, syncedAt: 7, progress: [3, 10] }),
    ]);
    expect(result).toEqual([
      book('local', { downloadedAt: 5, uploadedAt: null, syncedAt: null, progress: [3, 10] }),
    ]);
  });

  it('drops entries that exist only in the cloud', () => {
    const result = resetLibraryForServerSwitch([
      book('cloud-only', { uploadedAt: 6, downloadedAt: null }),
      book('local', { downloadedAt: 5 }),
    ]);
    expect(result.map((b) => b.hash)).toEqual(['local']);
  });

  it('keeps entries that never touched Readest Cloud', () => {
    const result = resetLibraryForServerSwitch([book('abs-stub', { absMediaType: 'podcast' })]);
    expect(result.map((b) => b.hash)).toEqual(['abs-stub']);
  });
});

describe('resetSettingsForServerSwitch', () => {
  it('resets only the Readest Cloud sync cursors', () => {
    const settings = {
      lastSyncedAtBooks: 10,
      lastSyncedAtConfigs: 20,
      lastSyncedAtNotes: 30,
      lastSyncedAtReplicas: { book: 'hlc-1' },
      kosync: { lastSyncedAt: 99 },
      telemetryEnabled: false,
    } as unknown as SystemSettings;
    expect(resetSettingsForServerSwitch(settings)).toEqual({
      ...settings,
      lastSyncedAtBooks: 0,
      lastSyncedAtConfigs: 0,
      lastSyncedAtNotes: 0,
      lastSyncedAtReplicas: {},
    });
  });
});

describe('switchServer', () => {
  const calls: string[] = [];
  const books = [book('cloud-only', { uploadedAt: 6 }), book('local', { downloadedAt: 5 })];
  const settings = { lastSyncedAtBooks: 10 } as unknown as SystemSettings;
  let appService: AppService;
  let logout: Mock<() => Promise<void>>;
  let reload: Mock<() => void>;

  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    writeStoredServerConfig(stored('https://old.example.com'));
    logout = vi.fn(async () => {
      calls.push('logout');
    });
    reload = vi.fn(() => {
      calls.push(`reload:${localStorage.getItem(SERVER_CONFIG_STORAGE_KEY) ? 'custom' : 'cloud'}`);
    });
    appService = {
      loadLibraryBooks: vi.fn(async () => books),
      saveLibraryBooks: vi.fn(async () => {
        calls.push('saveLibrary');
      }),
      loadSettings: vi.fn(async () => settings),
      saveSettings: vi.fn(async () => {
        calls.push('saveSettings');
      }),
    } as unknown as AppService;
  });

  it('signs out, resets, commits the new server, then reloads', async () => {
    const next = stored('https://new.example.com');
    await switchServer({ appService, logout, reload, next });

    expect(calls).toEqual(['logout', 'saveLibrary', 'saveSettings', 'reload:custom']);
    expect(readStoredServerConfig()).toEqual(next);
    expect(appService.saveLibraryBooks).toHaveBeenCalledWith(
      [book('local', { downloadedAt: 5, uploadedAt: null, syncedAt: null })],
      { replace: true },
    );
    expect(appService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedAtBooks: 0, lastSyncedAtReplicas: {} }),
    );
  });

  it('switching back to Readest Cloud clears the stored server', async () => {
    await switchServer({ appService, logout, reload, next: null });
    expect(localStorage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBeNull();
    expect(calls.at(-1)).toBe('reload:cloud');
  });

  it.each([
    'logout',
    'saveLibrary',
    'saveSettings',
  ])('keeps the previous server when %s fails', async (step) => {
    const fail = async () => {
      throw new Error(step);
    };
    if (step === 'logout') logout.mockImplementation(fail);
    if (step === 'saveLibrary') vi.mocked(appService.saveLibraryBooks).mockImplementation(fail);
    if (step === 'saveSettings') vi.mocked(appService.saveSettings).mockImplementation(fail);

    await expect(
      switchServer({ appService, logout, reload, next: stored('https://new.example.com') }),
    ).rejects.toThrow(step);
    expect(readStoredServerConfig()?.serverUrl).toBe('https://old.example.com');
    expect(reload).not.toHaveBeenCalled();
  });
});
