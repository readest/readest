import { create } from 'zustand';
import { interceptKeys } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';

declare global {
  interface Window {
    onNativeKeyDown?: (keyName: string) => void;
  }
}

const handleNativeKeyDown = (keyName: string) => {
  if (keyName === 'VolumeUp' || keyName === 'VolumeDown') {
    return eventDispatcher.dispatch('native-key-down', { keyName });
  }
  if (keyName === 'Back') {
    return eventDispatcher.dispatch('native-key-down', { keyName });
  }
  return false;
};

type DeviceControlState = {
  volumeKeysIntercepted: boolean;
  backKeyIntercepted: boolean;
  acquireVolumeKeyInterception: () => void;
  releaseVolumeKeyInterception: () => void;
  acquireBackKeyInterception: () => void;
  releaseBackKeyInterception: () => void;
};

export const useDeviceControlStore = create<DeviceControlState>((set) => ({
  volumeKeysIntercepted: false,
  backKeyIntercepted: false,

  acquireVolumeKeyInterception: () => {
    window.onNativeKeyDown = handleNativeKeyDown;
    interceptKeys({ volumeKeys: true });
    set({ volumeKeysIntercepted: true });
  },

  releaseVolumeKeyInterception: () => {
    interceptKeys({ volumeKeys: false });
    set({ volumeKeysIntercepted: false });
  },

  acquireBackKeyInterception: () => {
    window.onNativeKeyDown = handleNativeKeyDown;
    interceptKeys({ backKey: true });
    set({ backKeyIntercepted: true });
  },

  releaseBackKeyInterception: () => {
    interceptKeys({ backKey: false });
    set({ backKeyIntercepted: false });
  },
}));
