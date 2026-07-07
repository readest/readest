import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// getMediaSession() consults the platform helpers; mock them so each test can
// pin a platform without touching the real user agent / env.
vi.mock('@/utils/misc', () => ({
  getOSPlatform: vi.fn(),
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(),
}));

// mediaSession.ts imports these at module load; TauriMediaSession construction
// does not call them, but the imports must resolve in jsdom.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';
import { getOSPlatform } from '@/utils/misc';
import { isTauriAppPlatform } from '@/services/environment';

const setNavigatorMediaSession = (present: boolean) => {
  if (present) {
    Object.defineProperty(navigator, 'mediaSession', {
      value: { metadata: null, setActionHandler: vi.fn() },
      configurable: true,
    });
  } else if ('mediaSession' in navigator) {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  }
};

describe('getMediaSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setNavigatorMediaSession(false);
  });

  test('uses navigator.mediaSession on iOS, NOT the native plugin', () => {
    // iOS audio plays through the WebView (Edge TTS media element, or the silent
    // keep-alive element during system TTS), so navigator.mediaSession is what
    // surfaces the lock-screen cover + sentence + controls. Routing iOS through
    // the native plugin hid the Edge cover/sentence and gave system TTS no
    // controls (AVSpeechSynthesizer can't be surfaced that way). See #4676.
    vi.mocked(getOSPlatform).mockReturnValue('ios');
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    setNavigatorMediaSession(true);

    const result = getMediaSession();
    expect(result).not.toBeInstanceOf(TauriMediaSession);
    expect(result).toBe(navigator.mediaSession);
  });

  test('returns TauriMediaSession on Android Tauri (native foreground service)', () => {
    // Android is checked first, so it uses the native session even though the
    // WebView may also expose navigator.mediaSession.
    vi.mocked(getOSPlatform).mockReturnValue('android');
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    setNavigatorMediaSession(true);

    expect(getMediaSession()).toBeInstanceOf(TauriMediaSession);
  });

  test('falls back to navigator.mediaSession on the web', () => {
    vi.mocked(getOSPlatform).mockReturnValue('macos');
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    setNavigatorMediaSession(true);

    const result = getMediaSession();
    expect(result).not.toBeInstanceOf(TauriMediaSession);
    expect(result).toBe(navigator.mediaSession);
  });

  test('returns null when neither a native nor a web media session is available', () => {
    vi.mocked(getOSPlatform).mockReturnValue('linux');
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    setNavigatorMediaSession(false);

    expect(getMediaSession()).toBeNull();
  });
});

describe('TauriMediaSession.setActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requests POST_NOTIFICATIONS whenever the session activates', async () => {
    // The foreground-service media notification IS the lock-screen control; on
    // Android 13+ it is silently suppressed unless POST_NOTIFICATIONS is
    // granted. The request must fire on activation, NOT be gated on the
    // alwaysInForeground setting (regression from #4941, which dropped the
    // keepAppInForeground flag that used to drive it).
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:native-tts|checkPermissions') {
        return { postNotification: 'prompt' } as unknown;
      }
      return undefined as unknown;
    });

    const session = new TauriMediaSession();
    await session.setActive({ active: true });

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|checkPermissions');
    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|requestPermissions', {
      permissions: ['postNotification'],
    });
  });

  test('still activates the native session when the permission request throws', async () => {
    // A thrown/hung permission request must never abort the foreground-service
    // start, or the service never becomes foreground and the OS reclaims it on
    // idle (observed on MIUI: "Stopping service due to app idle").
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:native-tts|checkPermissions') {
        throw new Error('permission plugin unavailable');
      }
      return undefined as unknown;
    });

    const session = new TauriMediaSession();
    await session.setActive({ active: true });

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|set_media_session_active', {
      payload: { active: true },
    });
  });

  test('does not re-prompt once the permission is already decided', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:native-tts|checkPermissions') {
        return { postNotification: 'granted' } as unknown;
      }
      return undefined as unknown;
    });

    const session = new TauriMediaSession();
    await session.setActive({ active: true });

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|checkPermissions');
    expect(invoke).not.toHaveBeenCalledWith(
      'plugin:native-tts|requestPermissions',
      expect.anything(),
    );
  });
});
