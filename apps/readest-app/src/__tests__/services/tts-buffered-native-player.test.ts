import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { TTSController } from '@/services/tts/TTSController';

// BufferedTTSClient picks its audio player when it is built: the app-process
// AVPlayer on iOS Tauri, the WebAudio pipeline everywhere else.
const platform = vi.hoisted(() => ({ os: 'macos', iPad: false }));
const built = vi.hoisted(() => ({ native: 0, web: 0 }));

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => platform.os,
  isIPadOS: () => platform.iPad,
}));

vi.mock('@/services/tts/NativeAudioPlayer', () => ({
  NativeAudioPlayer: class {
    constructor() {
      built.native++;
    }
  },
}));

vi.mock('@/services/tts/WebAudioPlayer', () => ({
  WebAudioPlayer: class {
    constructor() {
      built.web++;
    }
  },
}));

import { EdgeTTSClient } from '@/services/tts/EdgeTTSClient';

const build = () => new EdgeTTSClient({} as unknown as TTSController);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(platform, { os: 'macos', iPad: false });
  Object.assign(built, { native: 0, web: 0 });
});

describe('BufferedTTSClient audio player', () => {
  test('plays natively on iOS Tauri', () => {
    platform.os = 'ios';
    build();
    expect(built).toEqual({ native: 1, web: 0 });
  });

  // iPadOS sends a desktop user agent, so the OS reads as macOS there (#6974).
  test('plays natively on an iPad in the Tauri app', () => {
    platform.iPad = true;
    build();
    expect(built).toEqual({ native: 1, web: 0 });
  });

  test('keeps WebAudio on macOS Tauri', () => {
    build();
    expect(built).toEqual({ native: 0, web: 1 });
  });
});
