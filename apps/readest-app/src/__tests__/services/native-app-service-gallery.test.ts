import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Saving an image to the Android gallery goes: ImageViewer -> NativeAppService ->
// the native-bridge plugin -> MediaStore.insert(). MediaStore is the part that
// differs between OEMs, so what we hand it has to stand on its own rather than
// lean on a particular provider's leniency (#5069 follow-up: Samsung One UI
// reported "Failed to save the image" where AOSP-ish providers were fine).

const osTypeMock = vi.fn().mockReturnValue('android');

const saveImageToGalleryMock = vi.fn().mockResolvedValue({ success: true, uri: 'content://1' });

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

vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/bridge', () => ({
  copyURIToPath: vi.fn().mockResolvedValue({ path: '' }),
  getStorefrontRegionCode: vi.fn().mockResolvedValue({ regionCode: null }),
  saveImageToGallery: (...args: unknown[]) => saveImageToGalleryMock(...args),
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

async function initAndroidService() {
  osTypeMock.mockReturnValue('android');
  vi.resetModules();
  const mod = await import('@/services/nativeAppService');
  const service = new mod.NativeAppService();
  await service.init();
  return service;
}

const pngBytes = () => new Uint8Array([0, 1, 2]).buffer as ArrayBuffer;

type GalleryRequest = { srcPath: string; fileName: string; mimeType: string; albumName?: string };

const requestOf = (call: number): GalleryRequest =>
  saveImageToGalleryMock.mock.calls[call]![0] as GalleryRequest;

describe('NativeAppService.saveImageToGallery', () => {
  beforeEach(() => {
    saveImageToGalleryMock.mockClear();
    saveImageToGalleryMock.mockResolvedValue({ success: true, uri: 'content://1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('gives every saved image its own MediaStore display name', async () => {
    const service = await initAndroidService();

    await service.saveImageToGallery('image.png', pngBytes(), 'image/png');
    await service.saveImageToGallery('image.png', pngBytes(), 'image/png');

    const first = requestOf(0);
    const second = requestOf(1);

    // A constant display name makes the insert depend on the provider quietly
    // de-duplicating it (AOSP renames to "image (1).png"; stricter OEM providers
    // reject the row instead). Name the file ourselves so it never collides.
    expect(first.fileName).not.toBe('image.png');
    expect(first.fileName).not.toBe(second.fileName);
    expect(first.fileName.endsWith('.png')).toBe(true);
    expect(second.fileName.endsWith('.png')).toBe(true);
    // The staged file the plugin reads must be the one we named.
    expect(first.srcPath.endsWith(first.fileName)).toBe(true);
    expect(second.srcPath.endsWith(second.fileName)).toBe(true);
  });

  test('logs the native error when the MediaStore insert fails', async () => {
    const service = await initAndroidService();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveImageToGalleryMock.mockResolvedValue({
      success: false,
      error: 'Failed to build unique file: /storage/emulated/0/Pictures/Readest image.png',
    });

    const saved = await service.saveImageToGallery('image.png', pngBytes(), 'image/png');

    expect(saved).toBe(false);
    // Without this the toast is all anyone gets, and an OEM-specific failure is
    // undiagnosable from a bug report.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save image to gallery'),
      'Failed to build unique file: /storage/emulated/0/Pictures/Readest image.png',
    );
  });
});
