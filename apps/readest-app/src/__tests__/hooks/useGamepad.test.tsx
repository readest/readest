import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGamepad } from '@/hooks/useGamepad';

const gamepad = {
  axes: [0, 0],
  buttons: [],
  connected: true,
  id: 'Test controller',
  index: 0,
  mapping: 'standard',
  timestamp: 0,
  vibrationActuator: null,
} as unknown as Gamepad;

const getGamepads = vi.fn<() => Gamepad[]>();
const requestAnimationFrame = vi.fn<(callback: FrameRequestCallback) => number>(() => 1);
const cancelAnimationFrame = vi.fn();

const dispatchGamepadEvent = (type: 'gamepadconnected' | 'gamepaddisconnected') => {
  const event = new Event(type) as GamepadEvent;
  Object.defineProperty(event, 'gamepad', { value: gamepad });
  act(() => window.dispatchEvent(event));
};

beforeEach(() => {
  getGamepads.mockReset().mockReturnValue([]);
  requestAnimationFrame.mockClear();
  cancelAnimationFrame.mockClear();
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: getGamepads });
  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useGamepad', () => {
  it('does not subscribe to the browser Gamepad API when disabled', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');

    renderHook(() => useGamepad({ enabled: false }));

    expect(getGamepads).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalledWith('gamepadconnected', expect.any(Function));
    expect(addEventListener).not.toHaveBeenCalledWith('gamepaddisconnected', expect.any(Function));
  });

  it('starts polling when a controller connection is reported', () => {
    renderHook(() => useGamepad());
    getGamepads.mockClear();
    getGamepads.mockReturnValue([gamepad]);

    dispatchGamepadEvent('gamepadconnected');

    expect(getGamepads).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('scans once without polling when enabled and no controller exists', () => {
    renderHook(() => useGamepad());

    expect(getGamepads).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('detects already-connected controllers eagerly when enabled', () => {
    getGamepads.mockReturnValue([gamepad]);

    renderHook(() => useGamepad());

    // One mount scan discovers the controller, then the first poll reads its
    // live button state.
    expect(getGamepads).toHaveBeenCalledTimes(2);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('stops polling when the last controller disconnects', () => {
    renderHook(() => useGamepad());
    getGamepads.mockReturnValue([gamepad]);
    dispatchGamepadEvent('gamepadconnected');
    getGamepads.mockReturnValue([]);

    dispatchGamepadEvent('gamepaddisconnected');

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it('keeps polling while another controller remains connected', () => {
    renderHook(() => useGamepad());
    getGamepads.mockReturnValue([gamepad]);
    dispatchGamepadEvent('gamepadconnected');
    cancelAnimationFrame.mockClear();

    dispatchGamepadEvent('gamepaddisconnected');

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it('removes browser listeners and polling when disabled after connection', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { rerender } = renderHook(({ enabled }) => useGamepad({ enabled }), {
      initialProps: { enabled: true },
    });
    getGamepads.mockReturnValue([gamepad]);
    dispatchGamepadEvent('gamepadconnected');

    rerender({ enabled: false });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(removeEventListener).toHaveBeenCalledWith('gamepadconnected', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('gamepaddisconnected', expect.any(Function));
  });
});
