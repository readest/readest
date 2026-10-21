import { afterEach, describe, expect, test, vi } from 'vitest';

import type { TTSController } from '@/services/tts/TTSController';
import type { AppService } from '@/types/system';

// BufferedTTSClient picks its audio player when it is built: the app-process
// AVPlayer in the iOS app, the WebAudio pipeline everywhere else.
const built = vi.hoisted(() => ({ native: 0, web: 0 }));

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

const build = (appService: Partial<AppService>) =>
  new EdgeTTSClient({} as unknown as TTSController, appService as AppService, null);

afterEach(() => {
  Object.assign(built, { native: 0, web: 0 });
});

describe('BufferedTTSClient audio player', () => {
  // Read from the app service, not the user agent: iPadOS sends a desktop
  // ("Macintosh") one (#6974).
  test('plays natively in the iOS app, iPad included', () => {
    build({ isIOSApp: true });
    expect(built).toEqual({ native: 1, web: 0 });
  });

  test('keeps WebAudio elsewhere', () => {
    build({ isIOSApp: false, isMacOSApp: true });
    expect(built).toEqual({ native: 0, web: 1 });
  });
});
