import { describe, expect, test, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const checkStatusMock = vi.fn();

vi.mock('@tauri-apps/plugin-biometric', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  checkStatus: (...args: unknown[]) => checkStatusMock(...args),
  BiometryType: { None: 0, TouchID: 1, FaceID: 2, Iris: 3 },
}));

import { BiometryType } from '@tauri-apps/plugin-biometric';
import {
  authenticateWithBiometrics,
  defaultBiometricUnlockOnPinSet,
  getBiometricStatus,
  getBiometryLabelKey,
  isBiometricSupported,
  shouldAttemptBiometricUnlock,
} from '@/services/biometric';

const mobile = (over: Partial<{ isIOSApp: boolean; isAndroidApp: boolean }> = {}) =>
  ({ isIOSApp: false, isAndroidApp: true, ...over }) as never;

beforeEach(() => {
  authenticateMock.mockReset();
  checkStatusMock.mockReset();
});

describe('isBiometricSupported', () => {
  test('true on iOS/Android app, false otherwise and for null', () => {
    expect(isBiometricSupported(mobile({ isIOSApp: true, isAndroidApp: false }))).toBe(true);
    expect(isBiometricSupported(mobile({ isAndroidApp: true }))).toBe(true);
    expect(isBiometricSupported({ isIOSApp: false, isAndroidApp: false } as never)).toBe(false);
    expect(isBiometricSupported(null)).toBe(false);
  });
});

describe('shouldAttemptBiometricUnlock', () => {
  test('requires all three conditions', () => {
    expect(
      shouldAttemptBiometricUnlock({
        isMobileApp: true,
        biometricUnlockEnabled: true,
        available: true,
      }),
    ).toBe(true);
    expect(
      shouldAttemptBiometricUnlock({
        isMobileApp: false,
        biometricUnlockEnabled: true,
        available: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptBiometricUnlock({
        isMobileApp: true,
        biometricUnlockEnabled: false,
        available: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptBiometricUnlock({
        isMobileApp: true,
        biometricUnlockEnabled: true,
        available: false,
      }),
    ).toBe(false);
  });
});

describe('defaultBiometricUnlockOnPinSet', () => {
  test('on only when mobile and available', () => {
    expect(defaultBiometricUnlockOnPinSet({ isMobileApp: true, available: true })).toBe(true);
    expect(defaultBiometricUnlockOnPinSet({ isMobileApp: true, available: false })).toBe(false);
    expect(defaultBiometricUnlockOnPinSet({ isMobileApp: false, available: true })).toBe(false);
  });
});

describe('getBiometryLabelKey', () => {
  test('maps biometry type to a label key', () => {
    expect(getBiometryLabelKey(BiometryType.FaceID)).toBe('Face ID');
    expect(getBiometryLabelKey(BiometryType.TouchID)).toBe('Touch ID');
    expect(getBiometryLabelKey(BiometryType.None)).toBe('biometrics');
    expect(getBiometryLabelKey(BiometryType.Iris)).toBe('biometrics');
  });
});

describe('getBiometricStatus', () => {
  test('returns availability from checkStatus', async () => {
    checkStatusMock.mockResolvedValue({ isAvailable: true, biometryType: BiometryType.FaceID });
    await expect(getBiometricStatus()).resolves.toEqual({
      available: true,
      biometryType: BiometryType.FaceID,
    });
  });

  test('returns unavailable when checkStatus throws', async () => {
    checkStatusMock.mockRejectedValue(new Error('no plugin'));
    await expect(getBiometricStatus()).resolves.toEqual({
      available: false,
      biometryType: BiometryType.None,
    });
  });
});

describe('authenticateWithBiometrics', () => {
  test('true when authenticate resolves', async () => {
    authenticateMock.mockResolvedValue(undefined);
    await expect(authenticateWithBiometrics('Unlock')).resolves.toBe(true);
    expect(authenticateMock).toHaveBeenCalledWith(
      'Unlock',
      expect.objectContaining({ allowDeviceCredential: false }),
    );
  });

  test('false when authenticate throws (cancel/fail)', async () => {
    authenticateMock.mockRejectedValue(new Error('userCancel'));
    await expect(authenticateWithBiometrics('Unlock')).resolves.toBe(false);
  });
});
