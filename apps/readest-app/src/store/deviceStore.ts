import { create } from 'zustand';
import { interceptKeys, getScreenBrightness, setScreenBrightness } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import { NativeTouchEventType } from '@/types/system';

declare global {
  interface Window {
    onNativeKeyDown?: (keyName: string, keyCode?: number) => void;
    onNativeTouch?: (event: NativeTouchEventType) => void;
  }
}

const handleNativeKeyDown = (keyName: string, keyCode?: number) => {
  // Back is handled synchronously so dialogs can consume it before it
  // bubbles; every other key (volume, media, learn-mode captures) is
  // dispatched asynchronously through the same channel.
  if (keyName === 'Back') {
    return eventDispatcher.dispatchSync('native-key-down', { keyName, keyCode });
  }
  return eventDispatcher.dispatch('native-key-down', { keyName, keyCode });
};

type DeviceControlState = {
  volumeKeysIntercepted: boolean;
  backKeyIntercepted: boolean;
  volumeKeysInterceptionCount: number;
  backKeyInterceptionCount: number;
  getScreenBrightness: () => Promise<number>; // 0.0 to 1.0
  setScreenBrightness: (brightness: number) => Promise<void>; // brightness: 0.0 to 1.0
  acquireVolumeKeyInterception: () => void;
  releaseVolumeKeyInterception: () => void;
  acquireBackKeyInterception: () => void;
  releaseBackKeyInterception: () => void;
  pageTurnerKeysIntercepted: boolean;
  pageTurnerKeysInterceptionCount: number;
  acquirePageTurnerKeyInterception: () => void;
  releasePageTurnerKeyInterception: () => void;
  setKeyLearnMode: (enabled: boolean) => void;
  listenToNativeTouchEvents: () => void;
};

export const useDeviceControlStore = create<DeviceControlState>((set, get) => ({
  volumeKeysIntercepted: false,
  backKeyIntercepted: false,
  volumeKeysInterceptionCount: 0,
  backKeyInterceptionCount: 0,
  pageTurnerKeysIntercepted: false,
  pageTurnerKeysInterceptionCount: 0,

  acquireVolumeKeyInterception: () => {
    const { volumeKeysInterceptionCount } = get();
    if (volumeKeysInterceptionCount == 0) {
      window.onNativeKeyDown = handleNativeKeyDown;
      interceptKeys({ volumeKeys: true });
      set({ volumeKeysIntercepted: true });
    }
    set({ volumeKeysInterceptionCount: volumeKeysInterceptionCount + 1 });
  },

  releaseVolumeKeyInterception: () => {
    const { volumeKeysInterceptionCount } = get();
    if (volumeKeysInterceptionCount <= 1) {
      interceptKeys({ volumeKeys: false });
      set({ volumeKeysIntercepted: false, volumeKeysInterceptionCount: 0 });
    } else {
      set({ volumeKeysInterceptionCount: volumeKeysInterceptionCount - 1 });
    }
  },

  acquireBackKeyInterception: () => {
    const { backKeyInterceptionCount } = get();
    if (backKeyInterceptionCount == 0) {
      window.onNativeKeyDown = handleNativeKeyDown;
      interceptKeys({ backKey: true });
      set({ backKeyIntercepted: true });
    }
    set({ backKeyInterceptionCount: backKeyInterceptionCount + 1 });
  },

  releaseBackKeyInterception: () => {
    const { backKeyInterceptionCount } = get();
    if (backKeyInterceptionCount <= 1) {
      interceptKeys({ backKey: false });
      set({ backKeyIntercepted: false, backKeyInterceptionCount: 0 });
    } else {
      set({ backKeyInterceptionCount: backKeyInterceptionCount - 1 });
    }
  },

  acquirePageTurnerKeyInterception: () => {
    const { pageTurnerKeysInterceptionCount } = get();
    if (pageTurnerKeysInterceptionCount == 0) {
      window.onNativeKeyDown = handleNativeKeyDown;
      interceptKeys({ pageTurnerKeys: true });
      set({ pageTurnerKeysIntercepted: true });
    }
    set({ pageTurnerKeysInterceptionCount: pageTurnerKeysInterceptionCount + 1 });
  },

  releasePageTurnerKeyInterception: () => {
    const { pageTurnerKeysInterceptionCount } = get();
    if (pageTurnerKeysInterceptionCount <= 1) {
      interceptKeys({ pageTurnerKeys: false });
      set({ pageTurnerKeysIntercepted: false, pageTurnerKeysInterceptionCount: 0 });
    } else {
      set({ pageTurnerKeysInterceptionCount: pageTurnerKeysInterceptionCount - 1 });
    }
  },

  // Learn mode is a stateless UI toggle (used while capturing a binding),
  // not reference-counted like the acquire/release interception actions.
  setKeyLearnMode: (enabled: boolean) => {
    window.onNativeKeyDown = handleNativeKeyDown;
    interceptKeys({ learnMode: enabled });
  },

  listenToNativeTouchEvents: () => {
    window.onNativeTouch = (event: NativeTouchEventType) => {
      return eventDispatcher.dispatch('native-touch', event);
    };
  },

  getScreenBrightness: async () => {
    const res = await getScreenBrightness();
    return res.brightness;
  },

  setScreenBrightness: async (brightness: number) => {
    await setScreenBrightness({ brightness });
  },
}));
