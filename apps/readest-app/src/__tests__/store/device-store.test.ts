import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useDeviceControlStore } from '@/store/deviceStore';

// Mock bridge functions
vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));

// Mock eventDispatcher
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    dispatchSync: vi.fn(),
  },
}));

beforeEach(() => {
  useDeviceControlStore.setState({
    volumeKeysIntercepted: false,
    backKeyIntercepted: false,
    volumeKeysInterceptionCount: 0,
    backKeyInterceptionCount: 0,
  });
  vi.clearAllMocks();
  // Clean up window handlers
  delete window.onNativeKeyDown;
  delete window.onNativeTouch;
});

describe('deviceStore', () => {
  // ── Volume key interception ────────────────────────────────────
  describe('acquireVolumeKeyInterception', () => {
    test('sets volumeKeysIntercepted to true on first acquire', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireVolumeKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
      expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(1);
      expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
    });

    test('increments count without re-intercepting on subsequent acquires', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      useDeviceControlStore.getState().acquireVolumeKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(2);
      // interceptKeys called only once (on first acquire)
      expect(interceptKeys).toHaveBeenCalledTimes(1);
    });

    test('sets window.onNativeKeyDown handler', () => {
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      expect(window.onNativeKeyDown).toBeDefined();
    });
  });

  describe('releaseVolumeKeyInterception', () => {
    test('releases interception when count reaches zero', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      useDeviceControlStore.getState().releaseVolumeKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
      expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(0);
      expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: false });
    });

    test('decrements count without releasing when count > 1', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      useDeviceControlStore.getState().releaseVolumeKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
      expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(1);
      // interceptKeys(false) should NOT have been called
      expect(interceptKeys).not.toHaveBeenCalledWith({ volumeKeys: false });
    });

    test('does not go below zero', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().releaseVolumeKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(0);
      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
      expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: false });
    });
  });

  // ── Back key interception ──────────────────────────────────────
  describe('acquireBackKeyInterception', () => {
    test('sets backKeyIntercepted to true on first acquire', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireBackKeyInterception();

      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(true);
      expect(useDeviceControlStore.getState().backKeyInterceptionCount).toBe(1);
      expect(interceptKeys).toHaveBeenCalledWith({ backKey: true });
    });

    test('increments count without re-intercepting on subsequent acquires', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireBackKeyInterception();
      useDeviceControlStore.getState().acquireBackKeyInterception();

      expect(useDeviceControlStore.getState().backKeyInterceptionCount).toBe(2);
      expect(interceptKeys).toHaveBeenCalledTimes(1);
    });

    test('sets window.onNativeKeyDown handler', () => {
      useDeviceControlStore.getState().acquireBackKeyInterception();
      expect(window.onNativeKeyDown).toBeDefined();
    });
  });

  describe('releaseBackKeyInterception', () => {
    test('releases interception when count reaches zero', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireBackKeyInterception();
      useDeviceControlStore.getState().releaseBackKeyInterception();

      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(false);
      expect(useDeviceControlStore.getState().backKeyInterceptionCount).toBe(0);
      expect(interceptKeys).toHaveBeenCalledWith({ backKey: false });
    });

    test('decrements count without releasing when count > 1', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireBackKeyInterception();
      useDeviceControlStore.getState().acquireBackKeyInterception();
      useDeviceControlStore.getState().releaseBackKeyInterception();

      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(true);
      expect(useDeviceControlStore.getState().backKeyInterceptionCount).toBe(1);
      expect(interceptKeys).not.toHaveBeenCalledWith({ backKey: false });
    });

    test('does not go below zero', async () => {
      useDeviceControlStore.getState().releaseBackKeyInterception();

      expect(useDeviceControlStore.getState().backKeyInterceptionCount).toBe(0);
      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(false);
    });
  });

  // ── Combined volume + back key usage ───────────────────────────
  describe('combined interception', () => {
    test('volume and back key interceptions are independent', async () => {
      const { interceptKeys } = await import('@/utils/bridge');
      useDeviceControlStore.getState().acquireVolumeKeyInterception();
      useDeviceControlStore.getState().acquireBackKeyInterception();

      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(true);

      useDeviceControlStore.getState().releaseVolumeKeyInterception();
      expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
      expect(useDeviceControlStore.getState().backKeyIntercepted).toBe(true);

      expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
      expect(interceptKeys).toHaveBeenCalledWith({ backKey: true });
      expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: false });
    });
  });

  // ── Screen brightness ──────────────────────────────────────────
  describe('getScreenBrightness', () => {
    test('returns brightness from bridge', async () => {
      const { getScreenBrightness } = await import('@/utils/bridge');
      vi.mocked(getScreenBrightness).mockResolvedValue({ brightness: 0.75 });

      const result = await useDeviceControlStore.getState().getScreenBrightness();
      expect(result).toBe(0.75);
      expect(getScreenBrightness).toHaveBeenCalled();
    });
  });

  describe('setScreenBrightness', () => {
    test('calls bridge with brightness value', async () => {
      const { setScreenBrightness } = await import('@/utils/bridge');
      vi.mocked(setScreenBrightness).mockResolvedValue({ success: true });

      await useDeviceControlStore.getState().setScreenBrightness(0.5);
      expect(setScreenBrightness).toHaveBeenCalledWith({ brightness: 0.5 });
    });
  });

  // ── Native touch events ────────────────────────────────────────
  describe('listenToNativeTouchEvents', () => {
    test('sets window.onNativeTouch handler', () => {
      useDeviceControlStore.getState().listenToNativeTouchEvents();
      expect(window.onNativeTouch).toBeDefined();
    });

    test('dispatches native-touch event when handler is called', async () => {
      const { eventDispatcher } = await import('@/utils/event');
      useDeviceControlStore.getState().listenToNativeTouchEvents();

      const touchEvent = {
        type: 'touchstart' as const,
        pointerId: 1,
        x: 10,
        y: 20,
        pressure: 0.5,
        pointerCount: 1,
        timestamp: Date.now(),
      };
      window.onNativeTouch?.(touchEvent);

      expect(eventDispatcher.dispatch).toHaveBeenCalledWith('native-touch', touchEvent);
    });
  });

  // ── Initial state ──────────────────────────────────────────────
  describe('initial state', () => {
    test('starts with no interceptions', () => {
      const state = useDeviceControlStore.getState();
      expect(state.volumeKeysIntercepted).toBe(false);
      expect(state.backKeyIntercepted).toBe(false);
      expect(state.volumeKeysInterceptionCount).toBe(0);
      expect(state.backKeyInterceptionCount).toBe(0);
    });
  });
});
