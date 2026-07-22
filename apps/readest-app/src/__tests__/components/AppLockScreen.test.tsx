import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const unlockMock = vi.fn();
const authenticateWithBiometricsMock = vi.fn();
const getBiometricStatusMock = vi.fn();
let isSupported = true;
let biometricUnlockEnabled = true;
let isMobileApp = true;

vi.mock('@/services/biometric', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/biometric')>('@/services/biometric');
  return {
    ...actual,
    isBiometricSupported: () => isSupported,
    getBiometricStatus: () => getBiometricStatusMock(),
    authenticateWithBiometrics: (...a: unknown[]) => authenticateWithBiometricsMock(...a),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: isMobileApp, isMobileApp } }),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));

vi.mock('@/store/appLockStore', () => ({
  useAppLockStore: () => ({
    pinHash: 'h',
    pinSalt: 's',
    unlock: unlockMock,
    biometricUnlockEnabled,
  }),
}));

vi.mock('@/components/PinInput', () => ({
  __esModule: true,
  default: ({ ariaLabel }: { ariaLabel: string }) => <input aria-label={ariaLabel} />,
}));

import AppLockScreen from '@/components/AppLockScreen';

beforeEach(() => {
  unlockMock.mockReset();
  authenticateWithBiometricsMock.mockReset();
  getBiometricStatusMock.mockReset();
  getBiometricStatusMock.mockResolvedValue({ available: true, biometryType: 2 });
  isSupported = true;
  biometricUnlockEnabled = true;
  isMobileApp = true;
});
afterEach(cleanup);

describe('AppLockScreen biometric gate', () => {
  it('auto-unlocks when biometric authentication succeeds on mount', async () => {
    authenticateWithBiometricsMock.mockResolvedValue(true);
    render(<AppLockScreen />);
    await waitFor(() => expect(unlockMock).toHaveBeenCalledTimes(1));
  });

  it('shows a retry button and stays locked when biometric fails', async () => {
    authenticateWithBiometricsMock.mockResolvedValue(false);
    render(<AppLockScreen />);
    await waitFor(() => expect(authenticateWithBiometricsMock).toHaveBeenCalledTimes(1));
    expect(unlockMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Use/ })).toBeTruthy();
    expect(screen.getByLabelText('PIN code')).toBeTruthy();
  });

  it('never calls biometric when unsupported (desktop/web)', async () => {
    isSupported = false;
    render(<AppLockScreen />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getBiometricStatusMock).not.toHaveBeenCalled();
    expect(authenticateWithBiometricsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Use/ })).toBeNull();
  });

  it('hides the PIN entry on mount while the biometric check is pending', () => {
    // getBiometricStatus resolves on a later microtask, so on the first
    // render the biometric attempt is still pending and the PIN entry must
    // not show behind the incoming system sheet.
    render(<AppLockScreen />);
    expect(screen.queryByText('Enter your PIN')).toBeNull();
    expect(screen.queryByLabelText('PIN code')).toBeNull();
  });

  it('keeps the PIN entry hidden while the biometric prompt is in flight', async () => {
    let resolveAuth: (v: boolean) => void = () => {};
    authenticateWithBiometricsMock.mockReturnValue(
      new Promise<boolean>((res) => {
        resolveAuth = res;
      }),
    );
    render(<AppLockScreen />);
    await waitFor(() => expect(authenticateWithBiometricsMock).toHaveBeenCalledTimes(1));
    // System Face ID sheet is up — the PIN entry must stay hidden behind it.
    expect(screen.queryByText('Enter your PIN')).toBeNull();
    expect(screen.queryByLabelText('PIN code')).toBeNull();
    // Dismiss/fail the sheet — now the PIN fallback is revealed.
    resolveAuth(false);
    await waitFor(() => expect(screen.getByLabelText('PIN code')).toBeTruthy());
    expect(screen.getByText('Enter your PIN')).toBeTruthy();
  });

  it('shows the PIN entry immediately when biometric is unsupported', () => {
    isSupported = false;
    render(<AppLockScreen />);
    expect(screen.getByLabelText('PIN code')).toBeTruthy();
    expect(screen.getByText('Enter your PIN')).toBeTruthy();
  });

  it('shows the PIN entry immediately when biometric unlock is disabled', () => {
    biometricUnlockEnabled = false;
    render(<AppLockScreen />);
    expect(screen.getByLabelText('PIN code')).toBeTruthy();
    expect(screen.getByText('Enter your PIN')).toBeTruthy();
  });
});
