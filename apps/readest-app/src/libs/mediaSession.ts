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
  keepAppInForeground?: boolean;
  notificationTitle?: string;
  notificationText?: string;
  foregroundServiceTitle?: string;
  foregroundServiceText?: string;
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

    const seekListener = await addPluginListener(
      'native-tts',
      'media-session-seek',
      (event: { payload: { position: number } }) => {
        const position = event.payload.position;
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
    try {
      if (sessionState.active) {
        if (sessionState.keepAppInForeground) {
          await this.requestPostNotificationPermission();
        }
        await this.initializeListeners();
      } else {
        await this.cleanupListeners();
      }
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

export function getMediaSession() {
  if ('mediaSession' in navigator) {
    return navigator.mediaSession;
  } else if (getOSPlatform() === 'android' && isTauriAppPlatform()) {
    return new TauriMediaSession();
  }
  return null;
}
