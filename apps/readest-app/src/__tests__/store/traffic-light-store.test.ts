import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock Tauri APIs
const mockIsFullscreen = vi.fn().mockResolvedValue(false);
const mockListen = vi
  .fn()
  .mockImplementation(async (_event: string, callback: (...args: unknown[]) => void) => {
    // Store the callback so tests can invoke it
    listenerMap[_event] = callback;
    return vi.fn(); // unlisten function
  });

const listenerMap: Record<string, (...args: unknown[]) => void> = {};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    isFullscreen: mockIsFullscreen,
    listen: mockListen,
  })),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { useTrafficLightStore } from '@/store/trafficLightStore';
import { invoke } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';

function createMockAppService(hasTrafficLight: boolean): AppService {
  return {
    hasTrafficLight,
  } as AppService;
}

describe('trafficLightStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useTrafficLightStore.setState({
      appService: undefined,
      isTrafficLightVisible: false,
      shouldShowTrafficLight: false,
      trafficLightInFullscreen: false,
      unlistenEnterFullScreen: undefined,
      unlistenExitFullScreen: undefined,
    });
    // Clear listener map
    for (const key of Object.keys(listenerMap)) {
      delete listenerMap[key];
    }
  });

  describe('initial state', () => {
    test('has traffic light hidden by default', () => {
      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.shouldShowTrafficLight).toBe(false);
      expect(state.trafficLightInFullscreen).toBe(false);
    });

    test('has no appService by default', () => {
      const state = useTrafficLightStore.getState();
      expect(state.appService).toBeUndefined();
    });
  });

  describe('initializeTrafficLightStore', () => {
    test('sets appService and visibility from hasTrafficLight=true', () => {
      const appService = createMockAppService(true);
      useTrafficLightStore.getState().initializeTrafficLightStore(appService);

      const state = useTrafficLightStore.getState();
      expect(state.appService).toBe(appService);
      expect(state.isTrafficLightVisible).toBe(true);
      expect(state.shouldShowTrafficLight).toBe(true);
    });

    test('sets visibility to false when hasTrafficLight=false', () => {
      const appService = createMockAppService(false);
      useTrafficLightStore.getState().initializeTrafficLightStore(appService);

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.shouldShowTrafficLight).toBe(false);
    });
  });

  describe('setTrafficLightVisibility', () => {
    test('sets visibility when not fullscreen', async () => {
      mockIsFullscreen.mockResolvedValue(false);

      await useTrafficLightStore.getState().setTrafficLightVisibility(true);

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(true);
      expect(state.shouldShowTrafficLight).toBe(true);
      expect(state.trafficLightInFullscreen).toBe(false);
    });

    test('hides visibility when in fullscreen even if visible=true', async () => {
      mockIsFullscreen.mockResolvedValue(true);

      await useTrafficLightStore.getState().setTrafficLightVisibility(true);

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.shouldShowTrafficLight).toBe(true);
      expect(state.trafficLightInFullscreen).toBe(true);
    });

    test('sets visible=false', async () => {
      mockIsFullscreen.mockResolvedValue(false);

      await useTrafficLightStore.getState().setTrafficLightVisibility(false);

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.shouldShowTrafficLight).toBe(false);
    });

    test('invokes set_traffic_lights with default position', async () => {
      mockIsFullscreen.mockResolvedValue(false);

      await useTrafficLightStore.getState().setTrafficLightVisibility(true);

      expect(invoke).toHaveBeenCalledWith('set_traffic_lights', {
        visible: true,
        x: 10.0,
        y: 22.0,
      });
    });

    test('invokes set_traffic_lights with custom position', async () => {
      mockIsFullscreen.mockResolvedValue(false);

      await useTrafficLightStore.getState().setTrafficLightVisibility(true, { x: 20, y: 30 });

      expect(invoke).toHaveBeenCalledWith('set_traffic_lights', {
        visible: true,
        x: 20,
        y: 30,
      });
    });
  });

  describe('initializeTrafficLightListeners', () => {
    test('registers fullscreen enter and exit listeners', async () => {
      await useTrafficLightStore.getState().initializeTrafficLightListeners();

      expect(mockListen).toHaveBeenCalledTimes(2);
      expect(mockListen).toHaveBeenCalledWith('will-enter-fullscreen', expect.anything());
      expect(mockListen).toHaveBeenCalledWith('will-exit-fullscreen', expect.anything());
    });

    test('stores unlisten functions', async () => {
      await useTrafficLightStore.getState().initializeTrafficLightListeners();

      const state = useTrafficLightStore.getState();
      expect(state.unlistenEnterFullScreen).toBeDefined();
      expect(state.unlistenExitFullScreen).toBeDefined();
    });

    test('enter-fullscreen callback hides traffic light when fullscreen', async () => {
      mockIsFullscreen.mockResolvedValue(true);
      await useTrafficLightStore.getState().initializeTrafficLightListeners();

      // Simulate entering fullscreen
      const enterCb = listenerMap['will-enter-fullscreen'];
      expect(enterCb).toBeDefined();
      await enterCb!();

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.trafficLightInFullscreen).toBe(true);
    });

    test('exit-fullscreen callback restores traffic light based on shouldShow', async () => {
      useTrafficLightStore.setState({ shouldShowTrafficLight: true });

      await useTrafficLightStore.getState().initializeTrafficLightListeners();

      // Simulate exiting fullscreen
      const exitCb = listenerMap['will-exit-fullscreen'];
      expect(exitCb).toBeDefined();
      exitCb!();

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(true);
      expect(state.trafficLightInFullscreen).toBe(false);
    });

    test('exit-fullscreen keeps hidden when shouldShowTrafficLight is false', async () => {
      useTrafficLightStore.setState({ shouldShowTrafficLight: false });

      await useTrafficLightStore.getState().initializeTrafficLightListeners();

      const exitCb = listenerMap['will-exit-fullscreen'];
      exitCb!();

      const state = useTrafficLightStore.getState();
      expect(state.isTrafficLightVisible).toBe(false);
      expect(state.trafficLightInFullscreen).toBe(false);
    });
  });

  describe('cleanupTrafficLightListeners', () => {
    test('calls unlisten functions and clears them', async () => {
      const unlistenEnter = vi.fn();
      const unlistenExit = vi.fn();

      useTrafficLightStore.setState({
        unlistenEnterFullScreen: unlistenEnter,
        unlistenExitFullScreen: unlistenExit,
      });

      useTrafficLightStore.getState().cleanupTrafficLightListeners();

      expect(unlistenEnter).toHaveBeenCalledTimes(1);
      expect(unlistenExit).toHaveBeenCalledTimes(1);

      const state = useTrafficLightStore.getState();
      expect(state.unlistenEnterFullScreen).toBeUndefined();
      expect(state.unlistenExitFullScreen).toBeUndefined();
    });

    test('handles missing unlisten functions gracefully', () => {
      useTrafficLightStore.setState({
        unlistenEnterFullScreen: undefined,
        unlistenExitFullScreen: undefined,
      });

      // Should not throw
      useTrafficLightStore.getState().cleanupTrafficLightListeners();

      const state = useTrafficLightStore.getState();
      expect(state.unlistenEnterFullScreen).toBeUndefined();
      expect(state.unlistenExitFullScreen).toBeUndefined();
    });
  });
});
