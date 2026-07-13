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

import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { getMediaSession, IOSCompositeMediaSession, TauriMediaSession } from '@/libs/mediaSession';
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

  test('returns the composite session on iOS Tauri (native + WebKit mirror)', () => {
    // iOS runs TWO now-playing clients: the native MPNowPlayingInfoCenter one
    // (plugin-driven) and WebKit's page client, which exists because the page
    // declares audioSession type 'playback' for WebAudio. Elections can pick
    // either; an unfed WebKit client renders a bare "localhost" card with
    // dead buttons. The composite feeds both.
    vi.mocked(getOSPlatform).mockReturnValue('ios');
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    setNavigatorMediaSession(true);

    expect(getMediaSession()).toBeInstanceOf(IOSCompositeMediaSession);
  });

  test('returns the plain TauriMediaSession on iOS Tauri without navigator.mediaSession', () => {
    vi.mocked(getOSPlatform).mockReturnValue('ios');
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    setNavigatorMediaSession(false);

    const session = getMediaSession();
    expect(session).toBeInstanceOf(TauriMediaSession);
    expect(session).not.toBeInstanceOf(IOSCompositeMediaSession);
  });

  test('uses navigator.mediaSession on iOS web (non-Tauri)', () => {
    vi.mocked(getOSPlatform).mockReturnValue('ios');
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
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
    // granted. The request must fire on every activation (it used to be gated
    // on an opt-in setting, which left the control missing by default).
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

describe('TauriMediaSession media-session-seek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes the native seek payload to the seekto handler', async () => {
    // addPluginListener delivers the native payload DIRECTLY (like the
    // native-bridge shared-intent listener), not wrapped in { payload }. The
    // seek listener used to read `event.payload.position`, which threw, so
    // lock-screen / Android Auto seeks silently did nothing while in-app seeks
    // (which call the controller directly) worked. Guard the payload shape.
    const listeners: Record<string, (payload: unknown) => void> = {};
    vi.mocked(addPluginListener).mockImplementation((async (
      _plugin: string,
      event: string,
      cb: (payload: unknown) => void,
    ) => {
      listeners[event] = cb;
      return { unregister: vi.fn() } as unknown as PluginListener;
    }) as unknown as typeof addPluginListener);
    vi.mocked(invoke).mockResolvedValue({ postNotification: 'granted' } as unknown);

    const session = new TauriMediaSession();
    const seekHandler = vi.fn();
    session.setActionHandler('seekto', seekHandler as (position: number) => void);
    await session.setActive({ active: true });

    // Native fires the payload directly: { position }.
    listeners['media-session-seek']!({ position: 42000 });
    expect(seekHandler).toHaveBeenCalledWith(42000);
  });
});

describe('IOSCompositeMediaSession', () => {
  interface FakeWebSession {
    metadata: unknown;
    playbackState: string;
    setActionHandler: ReturnType<typeof vi.fn>;
    setPositionState: ReturnType<typeof vi.fn>;
  }

  const makeWebSession = (): FakeWebSession => ({
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
  });

  class FakeMediaMetadata {
    title: string;
    artist: string;
    album: string;
    artwork: { src: string; type?: string }[];
    constructor(init: {
      title: string;
      artist: string;
      album: string;
      artwork: { src: string; type?: string }[];
    }) {
      this.title = init.title;
      this.artist = init.artist;
      this.album = init.album;
      this.artwork = init.artwork;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.mocked(invoke).mockResolvedValue(undefined as unknown);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('mirrors metadata (with artwork MIME) into navigator.mediaSession', async () => {
    const web = makeWebSession();
    const session = new IOSCompositeMediaSession(web as unknown as MediaSession);
    await session.updateMetadata({
      title: 'T',
      artist: 'A',
      album: 'B',
      artwork: 'data:image/jpeg;base64,x',
    });
    const metadata = web.metadata as FakeMediaMetadata;
    expect(metadata.title).toBe('T');
    // WebKit silently drops MIME-mismatched artwork; the type must be sniffed
    // from the data URL, not assumed.
    expect(metadata.artwork[0]!.type).toBe('image/jpeg');
    // The native surface is still fed too.
    expect(invoke).toHaveBeenCalledWith(
      'plugin:native-tts|update_media_session_metadata',
      expect.anything(),
    );
  });

  test('mirrors playback state and position into navigator.mediaSession', async () => {
    const web = makeWebSession();
    const session = new IOSCompositeMediaSession(web as unknown as MediaSession);
    await session.updatePlaybackState({ playing: true, position: 5000, duration: 10000 });
    expect(web.playbackState).toBe('playing');
    expect(web.setPositionState).toHaveBeenCalledWith({
      duration: 10,
      position: 5,
      playbackRate: 1,
    });
    await session.updatePlaybackState({ playing: false, position: 6000, duration: 10000 });
    expect(web.playbackState).toBe('paused');
  });

  test('mirrors handlers, converts seekto seconds to ms, and skips toggle', () => {
    const web = makeWebSession();
    const session = new IOSCompositeMediaSession(web as unknown as MediaSession);

    const play = vi.fn();
    session.setActionHandler('play', play);
    const playReg = web.setActionHandler.mock.calls.find((c) => c[0] === 'play')![1];
    playReg({});
    expect(play).toHaveBeenCalled();

    const seek = vi.fn();
    session.setActionHandler('seekto', seek as (position: number) => void);
    const seekReg = web.setActionHandler.mock.calls.find((c) => c[0] === 'seekto')![1];
    seekReg({ seekTime: 42 });
    expect(seek).toHaveBeenCalledWith(42000);

    session.setActionHandler('toggle', vi.fn());
    expect(web.setActionHandler.mock.calls.find((c) => c[0] === 'toggle')).toBeUndefined();
  });

  test('deactivation clears the web surface', async () => {
    const web = makeWebSession();
    web.playbackState = 'playing';
    web.metadata = {};
    const session = new IOSCompositeMediaSession(web as unknown as MediaSession);
    await session.setActive({ active: false });
    expect(web.metadata).toBeNull();
    expect(web.playbackState).toBe('none');
  });
});

describe('TauriMediaSession media-session-toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes the native toggle event to the toggle handler', async () => {
    // iOS togglePlayPauseCommand (lock-screen center button, headset click)
    // fires a dedicated toggle event: 'play'/'pause' are directional so that
    // audio-focus events (interruptions, route loss) can reuse them safely.
    const listeners: Record<string, (payload: unknown) => void> = {};
    vi.mocked(addPluginListener).mockImplementation((async (
      _plugin: string,
      event: string,
      cb: (payload: unknown) => void,
    ) => {
      listeners[event] = cb;
      return { unregister: vi.fn() } as unknown as PluginListener;
    }) as unknown as typeof addPluginListener);
    vi.mocked(invoke).mockResolvedValue({ postNotification: 'granted' } as unknown);

    const session = new TauriMediaSession();
    const toggleHandler = vi.fn();
    session.setActionHandler('toggle', toggleHandler);
    await session.setActive({ active: true });

    listeners['media-session-toggle']!(undefined);
    expect(toggleHandler).toHaveBeenCalled();
  });
});
