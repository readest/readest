import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addPluginListener } = vi.hoisted(() => ({ addPluginListener: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ addPluginListener }));

import { useAndroidGamepadConnection } from '@/hooks/useAndroidGamepadConnection';

interface GamepadConnectionPayload {
  connected: boolean;
}

let onConnectionChange: ((payload: GamepadConnectionPayload) => void) | undefined;
const unregister = vi.fn();

beforeEach(() => {
  onConnectionChange = undefined;
  unregister.mockReset();
  addPluginListener
    .mockReset()
    .mockImplementation(
      (_plugin: string, _event: string, callback: (payload: GamepadConnectionPayload) => void) => {
        onConnectionChange = callback;
        return Promise.resolve({ unregister });
      },
    );
});

afterEach(() => cleanup());

describe('useAndroidGamepadConnection', () => {
  it('does not register a native listener outside the Android app', () => {
    const { result } = renderHook(() => useAndroidGamepadConnection(false));

    expect(result.current).toBe(false);
    expect(addPluginListener).not.toHaveBeenCalled();
  });

  it('tracks native Android controller connection changes', async () => {
    const { result, unmount } = renderHook(() => useAndroidGamepadConnection(true));

    await waitFor(() => {
      expect(addPluginListener).toHaveBeenCalledWith(
        'native-bridge',
        'gamepad-connection',
        expect.any(Function),
      );
    });
    expect(result.current).toBe(false);

    act(() => onConnectionChange?.({ connected: true }));
    expect(result.current).toBe(true);

    act(() => onConnectionChange?.({ connected: false }));
    expect(result.current).toBe(false);

    unmount();
    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  });

  it('ignores connection callbacks after unmount', async () => {
    const { result, unmount } = renderHook(() => useAndroidGamepadConnection(true));
    await waitFor(() => expect(onConnectionChange).toBeTypeOf('function'));

    unmount();
    act(() => onConnectionChange?.({ connected: true }));

    expect(result.current).toBe(false);
  });

  it('unregisters when native registration resolves after unmount', async () => {
    let resolveListener: ((listener: { unregister: typeof unregister }) => void) | undefined;
    addPluginListener.mockImplementation(
      (_plugin: string, _event: string, callback: (payload: GamepadConnectionPayload) => void) => {
        onConnectionChange = callback;
        return new Promise((resolve) => {
          resolveListener = resolve;
        });
      },
    );
    const { unmount } = renderHook(() => useAndroidGamepadConnection(true));

    unmount();
    resolveListener?.({ unregister });

    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  });

  it('registers and unregisters as Android support is enabled and disabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAndroidGamepadConnection(enabled), {
      initialProps: { enabled: false },
    });
    expect(addPluginListener).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(addPluginListener).toHaveBeenCalledOnce());
    act(() => onConnectionChange?.({ connected: true }));
    expect(result.current).toBe(true);

    rerender({ enabled: false });
    expect(result.current).toBe(false);
    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  });
});
