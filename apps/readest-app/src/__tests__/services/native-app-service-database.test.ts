import { describe, test, expect, vi, beforeEach } from 'vitest';

// Turso opens a database file but never creates its folder: a path whose
// parent is missing fails with "I/O error (open): entity not found". The
// Dictionaries folder only exists once something was written there, so the
// first Yomitan import on a fresh install (or a new portable folder) failed
// on the plugin control database (#7068).

const calls: string[] = [];
const existingDirs = new Set<string>();

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => 'linux',
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => existingDirs.has(path)),
  mkdir: vi.fn(async (path: string) => {
    calls.push(`mkdir ${path}`);
    existingDirs.add(path);
  }),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  BaseDirectory: { AppData: 14 },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  ask: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
  basename: (p: string) => Promise.resolve(p.split('/').pop() ?? p),
  appDataDir: () => Promise.resolve('/tmp/app-data'),
  appConfigDir: () => Promise.resolve('/tmp/app-config'),
  appCacheDir: () => Promise.resolve('/tmp/app-cache'),
  appLogDir: () => Promise.resolve('/tmp/app-log'),
  tempDir: () => Promise.resolve('/tmp'),
}));

vi.mock('@/utils/file', () => ({
  NativeFile: class {},
  RemoteFile: class {},
}));

vi.mock('@/utils/files', () => ({
  copyFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/settingsService', () => ({
  getDefaultViewSettings: vi.fn().mockReturnValue({}),
  loadSettings: vi.fn().mockResolvedValue({ migrationVersion: 99999999 }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/database/nativeDatabaseService', () => ({
  NativeDatabaseService: {
    open: vi.fn(async (path: string) => {
      calls.push(`open ${path}`);
      return {};
    }),
  },
}));

vi.mock('@/services/database/migrate', () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
}));

describe('NativeAppService.openDatabase', () => {
  beforeEach(() => {
    calls.length = 0;
    existingDirs.clear();
  });

  test('creates the missing folder before opening the database', async () => {
    vi.resetModules();
    const { NativeAppService } = await import('@/services/nativeAppService');
    const service = new NativeAppService();
    await service.init();
    calls.length = 0;

    await service.openDatabase(
      'dictionary-plugin-control',
      'dictionary-plugin-control.sqlite3',
      'Dictionaries',
    );

    const opened = calls.findIndex((call) => call.startsWith('open '));
    const created = calls.findIndex((call) => /^mkdir .*Dictionaries$/.test(call));
    expect(created, 'Dictionaries folder created').toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(opened);
  });

  // Moving the data folder points every base at a new root, so a folder known
  // to exist under the old root says nothing about the new one.
  test('creates the folder again under a new data root', async () => {
    vi.resetModules();
    const { NativeAppService } = await import('@/services/nativeAppService');
    const service = new NativeAppService();
    await service.init();
    await service.openDatabase(
      'dictionary-plugin-control',
      'dictionary-plugin-control.sqlite3',
      'Dictionaries',
    );

    await service.setCustomRootDir('/new-root');
    calls.length = 0;
    await service.openDatabase(
      'dictionary-plugin-control',
      'dictionary-plugin-control.sqlite3',
      'Dictionaries',
    );

    const opened = calls.findIndex((call) => call.startsWith('open '));
    const created = calls.findIndex((call) => /^mkdir \/new-root\/.*Dictionaries$/.test(call));
    expect(created, 'Dictionaries folder created under the new root').toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(opened);
  });
});
