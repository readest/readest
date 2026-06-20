import { describe, test, expect, vi, beforeEach } from 'vitest';

const osTypeMock = vi.fn().mockReturnValue('macos');
const writeTextFileMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const mkdirMock = vi.fn().mockResolvedValue(undefined);
const saveDialogMock = vi.fn().mockResolvedValue('/tmp/exported.md');
const shareFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => osTypeMock(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  BaseDirectory: {},
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: (...args: unknown[]) => saveDialogMock(...args),
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
  shareFile: (...args: unknown[]) => shareFileMock(...args),
}));

vi.mock('@/utils/bridge', () => ({
  copyURIToPath: vi.fn().mockResolvedValue({ path: '' }),
  getStorefrontRegionCode: vi.fn().mockResolvedValue({ regionCode: null }),
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

async function loadServiceWithOS(os: 'macos' | 'windows' | 'linux' | 'ios' | 'android') {
  osTypeMock.mockReturnValue(os);
  vi.resetModules();
  const mod = await import('@/services/nativeAppService');
  return new mod.NativeAppService();
}

describe('NativeAppService.saveFile share gating', () => {
  beforeEach(() => {
    writeTextFileMock.mockClear();
    writeFileMock.mockClear();
    mkdirMock.mockClear();
    saveDialogMock.mockClear();
    shareFileMock.mockClear();
  });

  test('uses native share on macOS when share=true', async () => {
    const service = await loadServiceWithOS('macos');
    await service.saveFile('notes.md', 'hello', { share: true, mimeType: 'text/markdown' });
    expect(shareFileMock).toHaveBeenCalledTimes(1);
    expect(saveDialogMock).not.toHaveBeenCalled();
  });

  // Regression: on Windows the sharekit plugin's share UI blocks the main
  // thread waiting on cancel/complete callbacks that may never fire, freezing
  // the app. See issue #4343. Windows must fall through to the save dialog.
  test('falls through to save dialog on Windows when share=true', async () => {
    const service = await loadServiceWithOS('windows');
    await service.saveFile('notes.md', 'hello', { share: true, mimeType: 'text/markdown' });
    expect(shareFileMock).not.toHaveBeenCalled();
    expect(saveDialogMock).toHaveBeenCalledTimes(1);
  });

  test('falls through to save dialog on Linux when share=true', async () => {
    const service = await loadServiceWithOS('linux');
    await service.saveFile('notes.md', 'hello', { share: true, mimeType: 'text/markdown' });
    expect(shareFileMock).not.toHaveBeenCalled();
    expect(saveDialogMock).toHaveBeenCalledTimes(1);
  });

  // Regression (#4680): Tauri's Temp dir IS the Android cache dir, and the
  // sharekit plugin copies the shared file to `<cacheDir>/<name>` before
  // sharing. Writing the shareable file to the Temp ROOT makes that copy a
  // self-copy whose output stream truncates the source to 0 bytes (the shared
  // image came out 0 KB). The shareable file must live in a Temp SUBDIRECTORY.
  test('writes the shareable file to a Temp subdirectory to avoid self-copy truncation', async () => {
    const service = await loadServiceWithOS('android');
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await service.saveFile('image.png', bytes, { share: true, mimeType: 'image/png' });

    expect(shareFileMock).toHaveBeenCalledTimes(1);
    const sharedPath = shareFileMock.mock.calls[0]![0] as string;
    // Must NOT be `<tempDir>/image.png` — that collides with the plugin's
    // `File(cacheDir, "image.png")` destination and truncates to 0 bytes.
    expect(sharedPath).not.toBe('/tmp/image.png');
    expect(sharedPath).toContain('/shared/');
    expect(writeFileMock).toHaveBeenCalledWith(sharedPath, expect.any(Uint8Array));
    // The subdirectory is created before writing.
    expect(mkdirMock).toHaveBeenCalled();
  });

  // The book "Send" flow hands an already-on-disk file straight to the share
  // sheet via `filePath` and passes `null` content so nothing gets re-buffered
  // into memory. The file at `filePath` must be shared verbatim without any
  // write happening first.
  test('shares the file at filePath without buffering when content is null', async () => {
    const service = await loadServiceWithOS('macos');
    await service.saveFile('book.epub', null, {
      share: true,
      mimeType: 'application/epub+zip',
      filePath: '/abs/path/book.epub',
    });
    expect(shareFileMock).toHaveBeenCalledTimes(1);
    expect(shareFileMock).toHaveBeenCalledWith(
      '/abs/path/book.epub',
      expect.objectContaining({ mimeType: 'application/epub+zip' }),
    );
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(saveDialogMock).not.toHaveBeenCalled();
  });
});
