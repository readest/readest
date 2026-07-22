import { authenticate, checkStatus, BiometryType } from '@tauri-apps/plugin-biometric';

import type { AppService } from '@/types/system';
import { stubTranslation as _ } from '@/utils/misc';

/**
 * Everything biometric lives behind this wrapper so the rest of the app
 * never imports `@tauri-apps/plugin-biometric` directly. Off mobile-Tauri
 * the plugin commands are never reached (callers gate on
 * `isBiometricSupported`), and the async wrappers swallow errors so a
 * missing plugin can never throw into the UI.
 */

export const isBiometricSupported = (appService: AppService | null): boolean =>
  !!(appService?.isIOSApp || appService?.isAndroidApp);

export const getBiometricStatus = async (): Promise<{
  available: boolean;
  biometryType: BiometryType;
}> => {
  try {
    const status = await checkStatus();
    return { available: status.isAvailable, biometryType: status.biometryType };
  } catch {
    return { available: false, biometryType: BiometryType.None };
  }
};

export const authenticateWithBiometrics = async (reason: string): Promise<boolean> => {
  try {
    await authenticate(reason, { allowDeviceCredential: false });
    return true;
  } catch {
    // Cancel, no-match, lockout, or unavailable — fall back to the PIN.
    return false;
  }
};

export const shouldAttemptBiometricUnlock = (opts: {
  isMobileApp: boolean;
  biometricUnlockEnabled: boolean;
  available: boolean;
}): boolean => opts.isMobileApp && opts.biometricUnlockEnabled && opts.available;

export const defaultBiometricUnlockOnPinSet = (opts: {
  isMobileApp: boolean;
  available: boolean;
}): boolean => opts.isMobileApp && opts.available;

/**
 * i18n key for the biometry name. Returned key is fed back through `_()`
 * in the component (key-as-content i18n); `stubTranslation` here just
 * registers the strings for extraction.
 */
export const getBiometryLabelKey = (biometryType: BiometryType): string => {
  if (biometryType === BiometryType.FaceID) return _('Face ID');
  if (biometryType === BiometryType.TouchID) return _('Touch ID');
  return _('biometrics');
};
