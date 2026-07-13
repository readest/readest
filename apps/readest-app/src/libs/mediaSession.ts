import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { invoke } from '@tauri-apps/api/core';
import { addPluginListener, PluginListener, PermissionState } from '@tauri-apps/api/core';

export interface MediaMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

export interface PlaybackState {
  playing: boolean;
  position?: number; // in milliseconds
  duration?: number; // in milliseconds
}

export interface MediaSessionState {
  active: boolean;
  notificationTitle?: string;
  notificationText?: string;
  foregroundServiceTitle?: string;
  foregroundServiceText?: string;
  // Book identity persisted natively so Android Auto can offer a "Resume last
  // book" entry when the process is cold (no active session).
  bookHash?: string;
  bookTitle?: string;
  bookAuthor?: string;
}

interface Permissions {
  postNotification: PermissionState;
}

export class TauriMediaSession {
  private handlers: { [key: string]: (() => void) | ((position: number) => void) } = {};
  private eventListenerInited: boolean = false;
  private eventListeners: PluginListener[] = [];

  private async requestPostNotificationPermission() {
    const permission = await invoke<Permissions>('plugin:native-tts|checkPermissions');
    if (permission.postNotification.startsWith('prompt')) {
      await invoke<Permissions>('plugin:native-tts|requestPermissions', {
        permissions: ['postNotification'],
      });
    }
  }

  private async initializeListeners() {
    if (this.eventListenerInited) return;
    this.eventListenerInited = true;

    const playListener = await addPluginListener('native-tts', 'media-session-play', () => {
      if (this.handlers['play']) {
        (this.handlers['play'] as () => void)();
      }
    });
    this.eventListeners.push(playListener);

    const pauseListener = await addPluginListener('native-tts', 'media-session-pause', () => {
      if (this.handlers['pause']) {
        (this.handlers['pause'] as () => void)();
      }
    });
    this.eventListeners.push(pauseListener);

    // iOS single-button toggle (lock-screen center button, headset click).
    // Distinct from 'play'/'pause', which are directional so that audio-focus
    // events (interruptions, route loss) can reuse them safely.
    const toggleListener = await addPluginListener('native-tts', 'media-session-toggle', () => {
      if (this.handlers['toggle']) {
        (this.handlers['toggle'] as () => void)();
      }
    });
    this.eventListeners.push(toggleListener);

    const nextListener = await addPluginListener('native-tts', 'media-session-next', () => {
      if (this.handlers['nexttrack']) {
        (this.handlers['nexttrack'] as () => void)();
      }
    });
    this.eventListeners.push(nextListener);

    const previousListener = await addPluginListener('native-tts', 'media-session-previous', () => {
      if (this.handlers['previoustrack']) {
        (this.handlers['previoustrack'] as () => void)();
      }
    });
    this.eventListeners.push(previousListener);

    // iOS skip-interval commands (the icons the lock-screen card renders);
    // routed to the sentence-level seek handlers.
    const seekForwardListener = await addPluginListener(
      'native-tts',
      'media-session-seek-forward',
      () => {
        if (this.handlers['seekforward']) {
          (this.handlers['seekforward'] as () => void)();
        }
      },
    );
    this.eventListeners.push(seekForwardListener);

    const seekBackwardListener = await addPluginListener(
      'native-tts',
      'media-session-seek-backward',
      () => {
        if (this.handlers['seekbackward']) {
          (this.handlers['seekbackward'] as () => void)();
        }
      },
    );
    this.eventListeners.push(seekBackwardListener);

    const seekListener = await addPluginListener(
      'native-tts',
      'media-session-seek',
      // addPluginListener delivers the payload directly (as the other native-tts
      // and native-bridge listeners consume it) — reading `.payload.position`
      // threw, so lock-screen / Android Auto seeks never reached seekToTime.
      (payload: { position: number }) => {
        const position = payload.position;
        if (this.handlers['seekto']) {
          (this.handlers['seekto'] as (position: number) => void)(position);
        }
      },
    );
    this.eventListeners.push(seekListener);
  }

  private async cleanupListeners() {
    for (const listener of this.eventListeners) {
      await listener.unregister();
    }
    this.eventListeners = [];
    this.eventListenerInited = false;
  }

  async updateMetadata(metadata: MediaMetadata) {
    try {
      await invoke('plugin:native-tts|update_media_session_metadata', { payload: metadata });
    } catch (error) {
      console.error('Failed to update media metadata:', error);
    }
  }

  async updatePlaybackState(state: PlaybackState) {
    try {
      await invoke('plugin:native-tts|update_media_session_state', { payload: state });
    } catch (error) {
      console.error('Failed to update playback state:', error);
    }
  }

  async setActive(sessionState: MediaSessionState) {
    if (sessionState.active) {
      // The foreground-service media notification IS the lock-screen control;
      // on Android 13+ it is silently suppressed unless POST_NOTIFICATIONS is
      // granted. Request it on every activation (no-op once decided).
      // Best-effort: it must never block or abort the foreground-service start
      // below, so it gets its own catch.
      try {
        await this.requestPostNotificationPermission();
      } catch (error) {
        console.warn('POST_NOTIFICATIONS request failed:', error);
      }
      try {
        await this.initializeListeners();
      } catch (error) {
        console.warn('Media session listener init failed:', error);
      }
    } else {
      try {
        await this.cleanupListeners();
      } catch (error) {
        console.warn('Media session listener cleanup failed:', error);
      }
    }
    try {
      await invoke('plugin:native-tts|set_media_session_active', {
        payload: sessionState,
      });
    } catch (error) {
      console.error('Failed to set media session active state:', error);
    }
  }

  setActionHandler(action: string, handler: (() => void) | ((position: number) => void) | null) {
    if (handler) {
      this.handlers[action] = handler;
    } else {
      delete this.handlers[action];
    }
  }
}

// iOS runs TWO now-playing clients for the app: the native
// MPNowPlayingInfoCenter one (driven by TauriMediaSession through the plugin)
// and WebKit's own page client, which exists because the page declares
// audioSession type 'playback' for its WebAudio (see
// ttsMediaBridge.unblockAudio). System elections can pick EITHER client — an
// unfed WebKit client renders as a bare "localhost" card with dead buttons.
// This composite mirrors every update and handler into navigator.mediaSession
// so whichever client wins, the card is correct and transport works.
export class IOSCompositeMediaSession extends TauriMediaSession {
  private web: globalThis.MediaSession;

  constructor(web: globalThis.MediaSession) {
    super();
    this.web = web;
  }

  override async updateMetadata(metadata: MediaMetadata): Promise<void> {
    try {
      const MediaMetadataCtor = (
        globalThis as {
          MediaMetadata?: new (init: {
            title: string;
            artist: string;
            album: string;
            artwork: { src: string; type?: string }[];
          }) => globalThis.MediaMetadata;
        }
      ).MediaMetadata;
      if (MediaMetadataCtor) {
        const artwork = metadata.artwork
          ? [
              {
                src: metadata.artwork,
                // WebKit silently drops MIME-mismatched artwork; sniff the
                // type from the data URL instead of assuming one.
                type: /^data:(image\/[a-z+]+)/.exec(metadata.artwork)?.[1] ?? 'image/png',
              },
            ]
          : [];
        this.web.metadata = new MediaMetadataCtor({
          title: metadata.title ?? '',
          artist: metadata.artist ?? '',
          album: metadata.album ?? '',
          artwork,
        });
      }
    } catch {
      // The web mirror is best-effort; the native surface still has the data.
    }
    await super.updateMetadata(metadata);
  }

  override async updatePlaybackState(state: PlaybackState): Promise<void> {
    try {
      this.web.playbackState = state.playing ? 'playing' : 'paused';
      const duration = (state.duration ?? 0) / 1000;
      if (duration > 0) {
        const position = Math.min(Math.max((state.position ?? 0) / 1000, 0), duration);
        this.web.setPositionState?.({
          duration,
          position,
          playbackRate: state.playing ? 1 : 0,
        });
      }
    } catch {
      // Position state is cosmetic on the web mirror.
    }
    await super.updatePlaybackState(state);
  }

  override async setActive(sessionState: MediaSessionState): Promise<void> {
    if (!sessionState.active) {
      try {
        this.web.metadata = null;
        this.web.playbackState = 'none';
      } catch {
        // Best-effort teardown.
      }
    }
    await super.setActive(sessionState);
  }

  override setActionHandler(
    action: string,
    handler: (() => void) | ((position: number) => void) | null,
  ): void {
    super.setActionHandler(action, handler);
    // 'toggle' is not in the web MediaSession action vocabulary.
    if (action === 'toggle') return;
    try {
      if (!handler) {
        this.web.setActionHandler(action as MediaSessionAction, null);
      } else if (action === 'seekto') {
        this.web.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
          if (typeof details.seekTime === 'number') {
            // The Tauri-side seekto contract is milliseconds.
            (handler as (position: number) => void)(details.seekTime * 1000);
          }
        });
      } else {
        this.web.setActionHandler(action as MediaSessionAction, () => {
          (handler as () => void)();
        });
      }
    } catch {
      // Unsupported action on this WebKit.
    }
  }
}

export function getMediaSession() {
  const platform = getOSPlatform();
  // Android: the native foreground-service media session (TextToSpeech and
  // WebAudio both run with the app as the media owner; the Android WebView
  // doesn't expose a usable Media Session here).
  if (platform === 'android' && isTauriAppPlatform()) {
    return new TauriMediaSession();
  }
  // iOS: native MPNowPlayingInfoCenter/MPRemoteCommandCenter via the plugin.
  // Since the WebAudio engine (#4931) TTS plays with NO HTMLMediaElement, so
  // navigator.mediaSession publishes nothing (the 0.11.18 lock-screen
  // regression). Reintroducing an element (MediaStream output) made WebKit
  // publish the element's own stream clock, fighting setPositionState on the
  // lock screen and CarPlay (jumping timeline, running-while-paused). The
  // native session drives the plugin — mirrored into navigator.mediaSession
  // because WebKit ALSO registers a page client once audioSession type
  // 'playback' is declared (see IOSCompositeMediaSession).
  if (platform === 'ios' && isTauriAppPlatform()) {
    if ('mediaSession' in navigator) {
      return new IOSCompositeMediaSession(navigator.mediaSession);
    }
    return new TauriMediaSession();
  }
  // Web: navigator.mediaSession, driven by whatever media element plays.
  if ('mediaSession' in navigator) {
    return navigator.mediaSession;
  }
  return null;
}
