import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';

// Matches readest's standard `h-11` header (44px). Used as a fallback
// when a caller flips visibility without supplying its own measured
// height — e.g. the initial `useTrafficLight()` mount on pages whose
// header height is fixed.
const DEFAULT_HEADER_HEIGHT = 44;

interface TrafficLightState {
  appService?: AppService;
  isTrafficLightVisible: boolean;
  shouldShowTrafficLight: boolean;
  trafficLightInFullscreen: boolean;
  headerHeight: number;
  initializeTrafficLightStore: (appService: AppService) => void;
  setTrafficLightVisibility: (visible: boolean, headerHeight?: number) => void;
  initializeTrafficLightListeners: () => Promise<void>;
  cleanupTrafficLightListeners: () => void;
  unlistenEnterFullScreen?: () => void;
  unlistenExitFullScreen?: () => void;
}

export const useTrafficLightStore = create<TrafficLightState>((set, get) => {
  return {
    appService: undefined,
    isTrafficLightVisible: false,
    shouldShowTrafficLight: false,
    trafficLightInFullscreen: false,
    headerHeight: DEFAULT_HEADER_HEIGHT,

    initializeTrafficLightStore: (appService: AppService) => {
      set({
        appService,
        isTrafficLightVisible: appService.hasTrafficLight,
        shouldShowTrafficLight: appService.hasTrafficLight,
      });
    },

    setTrafficLightVisibility: async (visible: boolean, headerHeight?: number) => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const isFullscreen = await currentWindow.isFullscreen();
      const nextHeight = headerHeight ?? get().headerHeight;
      set({
        isTrafficLightVisible: !isFullscreen && visible,
        shouldShowTrafficLight: visible,
        trafficLightInFullscreen: isFullscreen,
        headerHeight: nextHeight,
      });
      // Rust reads the close button's natural rest position from cocoa
      // and combines it with `headerHeight` to compute the y that
      // visually centers the buttons. The formula self-adjusts across
      // macOS versions because Apple's per-version offset is encoded
      // in the button's frame.origin.y, not in our code.
      invoke('set_traffic_lights', { visible, headerHeight: nextHeight });
    },

    initializeTrafficLightListeners: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();

      const unlistenEnterFullScreen = await currentWindow.listen(
        'will-enter-fullscreen',
        async () => {
          const fullscreen = await currentWindow.isFullscreen();
          if (fullscreen) {
            set({ isTrafficLightVisible: false, trafficLightInFullscreen: true });
          }
        },
      );

      const unlistenExitFullScreen = await currentWindow.listen('will-exit-fullscreen', () => {
        const { shouldShowTrafficLight } = get();
        set({ isTrafficLightVisible: shouldShowTrafficLight, trafficLightInFullscreen: false });
      });

      set({ unlistenEnterFullScreen, unlistenExitFullScreen });
    },

    cleanupTrafficLightListeners: () => {
      const { unlistenEnterFullScreen, unlistenExitFullScreen } = get();
      if (unlistenEnterFullScreen) unlistenEnterFullScreen();
      if (unlistenExitFullScreen) unlistenExitFullScreen();
      set({ unlistenEnterFullScreen: undefined, unlistenExitFullScreen: undefined });
    },
  };
});
