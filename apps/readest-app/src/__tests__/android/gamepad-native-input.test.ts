import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = process.cwd();
const readerContent = readFileSync(
  resolve(appRoot, 'src/app/reader/components/ReaderContent.tsx'),
  'utf8',
);
const nativeBridgePlugin = readFileSync(
  resolve(
    appRoot,
    'src-tauri/plugins/tauri-plugin-native-bridge/android/src/main/java/NativeBridgePlugin.kt',
  ),
  'utf8',
);
const mainActivity = readFileSync(
  resolve(appRoot, 'src-tauri/gen/android/app/src/main/java/com/bilingify/readest/MainActivity.kt'),
  'utf8',
);

describe('Android gamepad input (#5693)', () => {
  it('enables the Web Gamepad API only when native Android reports a controller', () => {
    expect(readerContent).toContain('useAndroidGamepadConnection');
    expect(readerContent).toContain(
      'appService !== null && (!isAndroidApp || androidGamepadConnected)',
    );
  });

  it('detects already-connected controllers and listens for device changes natively', () => {
    expect(nativeBridgePlugin).toContain('InputManager.InputDeviceListener');
    expect(nativeBridgePlugin).toContain('inputManager.inputDeviceIds.any');
    expect(nativeBridgePlugin).toContain('InputDevice.SOURCE_GAMEPAD');
    expect(nativeBridgePlugin).toContain('InputDevice.SOURCE_JOYSTICK');
    expect(nativeBridgePlugin).toContain('registerInputDeviceListener');
    expect(nativeBridgePlugin).toContain('unregisterInputDeviceListener');
    expect(nativeBridgePlugin).toContain('"gamepad-connection"');
  });

  it('handles unavailable devices, suppresses duplicates, and forces initial state delivery', () => {
    expect(nativeBridgePlugin).toContain('inputManager ?: return false');
    expect(nativeBridgePlugin).toContain('getInputDevice(deviceId) ?: return@any false');
    expect(nativeBridgePlugin).toContain('connected == gamepadConnected');
    expect(nativeBridgePlugin).toContain('if (!hasListener(GAMEPAD_CONNECTION_EVENT)) return');
    expect(nativeBridgePlugin).toContain('emitGamepadConnection(force = true)');
  });

  it('leaves controller normalization to the Web Gamepad API', () => {
    expect(mainActivity).not.toContain('gamepadKeyMap');
    expect(mainActivity).not.toContain('dispatchGamepadButton');
    expect(mainActivity).not.toContain('dispatchGenericMotionEvent(event: MotionEvent)');
  });
});
