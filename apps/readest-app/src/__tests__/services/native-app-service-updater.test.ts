import { describe, test, expect, vi, beforeEach } from 'vitest';

// Controls what the mocked `is_updater_disabled` Tauri command returns.
let updaterDisabled = false;

const osTypeMock = vi.fn().mockReturnValue('linux');
const invokeMock = vi.fn((cmd: string) => {
  if (cmd === 'get_executable_dir') return Promise.resolve('/exec');
  if (cmd === 'is_updater_disabled') return Promise.resolve(updaterDisabled);
  return Promise.resolve(undefined);
});

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => osTypeMock(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  BaseDirectory: {},
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string])),
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

vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/bridge', () => ({
  copyURIToPath: vi.fn().mockResolvedValue({ path: '' }),
  getStorefrontRegionCode: vi.fn().mockResolvedValue({ regionCode: null }),
  saveImageToGallery: vi.fn().mockResolvedValue(undefined),
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

async function initServiceWithOS(os: 'macos' | 'windows' | 'linux' | 'ios' | 'android') {
  osTypeMock.mockReturnValue(os);
  vi.resetModules();
  const mod = await import('@/services/nativeAppService');
  const service = new mod.NativeAppService();
  await service.init();
  return service;
}

describe('NativeAppService updater gating (issue #4874)', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    updaterDisabled = false;
    delete (window as { __READEST_UPDATER_DISABLED?: boolean }).__READEST_UPDATER_DISABLED;
  });

  test('disables the in-app updater when Rust reports it is disabled', async () => {
    updaterDisabled = true;
    const service = await initServiceWithOS('linux');
    expect(invokeMock).toHaveBeenCalledWith('is_updater_disabled');
    expect(service.hasUpdater).toBe(false);
  });

  test('keeps the in-app updater when Rust reports it is enabled', async () => {
    updaterDisabled = false;
    const service = await initServiceWithOS('linux');
    expect(service.hasUpdater).toBe(true);
  });

  test('honors the Rust decision on macOS (env opt-out)', async () => {
    updaterDisabled = true;
    const service = await initServiceWithOS('macos');
    expect(service.hasUpdater).toBe(false);
  });

  test('does not query or enable the updater on mobile', async () => {
    updaterDisabled = false;
    const service = await initServiceWithOS('ios');
    expect(invokeMock).not.toHaveBeenCalledWith('is_updater_disabled');
    expect(service.hasUpdater).toBe(false);
  });
});
