import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';

interface TrafficLightState {
  appService?: AppService;
  isTrafficLightVisible: boolean;
  shouldShowTrafficLight: boolean;
  trafficLightInFullscreen: boolean;
  initializeTrafficLightStore: (appService: AppService) => void;
  setTrafficLightVisibility: (visible: boolean) => void;
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

    initializeTrafficLightStore: (appService: AppService) => {
      set({
        appService,
        isTrafficLightVisible: appService.hasTrafficLight,
        shouldShowTrafficLight: appService.hasTrafficLight,
      });
    },

    setTrafficLightVisibility: async (visible: boolean) => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const isFullscreen = await currentWindow.isFullscreen();
      set({
        isTrafficLightVisible: !isFullscreen && visible,
        shouldShowTrafficLight: visible,
        trafficLightInFullscreen: isFullscreen,
      });
      // Position is owned by Tauri's `trafficLightPosition` declared
      // at window creation; this IPC only toggles whether the title
      // bar is collapsed (to hide the buttons during reader chrome
      // auto-hide) or restored.
      invoke('set_traffic_lights', { visible });
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
