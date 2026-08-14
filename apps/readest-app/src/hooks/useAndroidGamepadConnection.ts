import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

interface GamepadConnectionPayload {
  connected: boolean;
}

/**
 * Android WebView starts Chromium's Gamepad polling thread as soon as the
 * browser API is observed. Use Android's event-driven InputManager only to
 * decide when a real controller is present; the existing Web Gamepad hook can
 * then retain Chromium's normalized button and axis mappings.
 */
export function useAndroidGamepadConnection(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    const listener: Promise<PluginListener> = addPluginListener<GamepadConnectionPayload>(
      'native-bridge',
      'gamepad-connection',
      (payload) => {
        if (!disposed) setConnected(payload.connected);
      },
    );

    return () => {
      disposed = true;
      listener.then((registered) => registered.unregister()).catch(() => {});
    };
  }, [enabled]);

  return enabled && connected;
}
