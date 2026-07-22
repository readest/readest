import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

export interface CarPlayState {
  active: boolean;
  title?: string;
  author?: string;
}

// Report the current TTS now-reading state to the native CarPlay scene
// delegate. iOS + Tauri only; a no-op everywhere else. Best-effort: CarPlay is
// an ambient surface, so a failed invoke must never disrupt playback.
export async function notifyCarPlayState(state: CarPlayState): Promise<void> {
  if (getOSPlatform() !== 'ios' || !isTauriAppPlatform()) return;
  try {
    await invoke('plugin:native-tts|update_carplay_state', {
      payload: { active: state.active, title: state.title ?? '', author: state.author ?? '' },
    });
  } catch (error) {
    console.warn('Failed to update CarPlay state:', error);
  }
}
