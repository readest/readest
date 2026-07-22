import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';

// Sentinel handed to the native bridge to release any app override and give
// screen brightness back to the system: iOS restores the value captured before
// the override, Android clears BRIGHTNESS_OVERRIDE_NONE. See issue #4885.
const RELEASE_BRIGHTNESS = -1;

/**
 * Applies the user's manual reading brightness while the reader is open and
 * releases control back to the system when the reader closes or the user
 * switches "System Screen Brightness" back on.
 *
 * The native iOS bridge additionally restores the system brightness whenever
 * the app backgrounds (and re-applies on foreground), so ambient auto-brightness
 * never stays locked after leaving the app — the reader component does not
 * unmount when the app is merely sent to the home screen.
 */
export const useScreenBrightness = () => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { setScreenBrightness } = useDeviceControlStore();

  const hasScreenBrightness = !!appService?.hasScreenBrightness;
  const { screenBrightness, autoScreenBrightness } = settings;

  useEffect(() => {
    if (!hasScreenBrightness) return;
    if (!autoScreenBrightness && screenBrightness >= 0) {
      setScreenBrightness(screenBrightness / 100);
    } else {
      setScreenBrightness(RELEASE_BRIGHTNESS);
    }
    return () => {
      setScreenBrightness(RELEASE_BRIGHTNESS);
    };
    // Deliberately not depending on `screenBrightness`: live slider/gesture
    // updates are pushed by their own handlers, so re-running here would flash
    // the screen (release then re-apply) mid-drag. We only (re)apply on mount
    // and when the auto/manual mode flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScreenBrightness, autoScreenBrightness, setScreenBrightness]);
};
