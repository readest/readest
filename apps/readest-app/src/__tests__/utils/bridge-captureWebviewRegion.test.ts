import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const osPlatform = vi.fn();
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => osPlatform() }));

import { captureWebviewRegion } from '@/utils/bridge';

describe('captureWebviewRegion', () => {
  const image = new ArrayBuffer(8);
  const bitmap = { width: 600, height: 800 };
  const createImageBitmap = vi.fn().mockResolvedValue(bitmap);
  const region = { x: 240, y: 10.5, width: 300, height: 400 };

  beforeEach(() => {
    invoke.mockResolvedValue(image);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('devicePixelRatio', 2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    'windows',
    'linux',
  ])('crops the region out of the whole-view capture on %s', async (platform) => {
    osPlatform.mockReturnValue(platform);
    await expect(captureWebviewRegion(region)).resolves.toBe(bitmap);
    expect(invoke).toHaveBeenCalledWith('plugin:native-bridge|capture_webview_region', {
      payload: region,
    });
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), 480, 21, 600, 800);
  });

  it.each([
    'macos',
    'ios',
    'android',
  ])('returns the native region bytes on %s', async (platform) => {
    osPlatform.mockReturnValue(platform);
    await expect(captureWebviewRegion(region)).resolves.toBe(image);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
