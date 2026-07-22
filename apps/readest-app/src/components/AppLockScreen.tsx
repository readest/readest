'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import PinInput from '@/components/PinInput';
import { useEnv } from '@/context/EnvContext';
import { PIN_LENGTH, verifyPin } from '@/libs/crypto/applock';
import { useAppLockStore } from '@/store/appLockStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  authenticateWithBiometrics,
  getBiometricStatus,
  getBiometryLabelKey,
  isBiometricSupported,
  shouldAttemptBiometricUnlock,
} from '@/services/biometric';

export default function AppLockScreen() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { pinHash, pinSalt, unlock, biometricUnlockEnabled } = useAppLockStore();
  const [biometryLabel, setBiometryLabel] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [kbInset, setKbInset] = useState(0);
  // Keep the PIN entry hidden while a biometric attempt is pending or its
  // native sheet is on screen, so the user only ever sees one unlock method
  // at a time (the system Face ID / Touch ID sheet, then the PIN fallback).
  // Seeded from the synchronous platform check so the PIN never flashes
  // before the sheet on a biometric-enabled launch.
  const [biometricBusy, setBiometricBusy] = useState(
    () => isBiometricSupported(appService) && !!biometricUnlockEnabled,
  );
  const biometricAttemptedRef = useRef(false);
  const biometricInFlightRef = useRef(false);
  const autoFocusEnabled = !appService?.isMobile;

  const runBiometric = async () => {
    if (biometricInFlightRef.current) return;
    biometricInFlightRef.current = true;
    setBiometricBusy(true);
    try {
      const ok = await authenticateWithBiometrics(_('Unlock Readest'));
      if (ok) unlock();
    } finally {
      biometricInFlightRef.current = false;
      setBiometricBusy(false);
    }
  };

  useEffect(() => {
    if (!isBiometricSupported(appService)) {
      setBiometricBusy(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { available, biometryType } = await getBiometricStatus();
      if (cancelled) return;
      if (
        !shouldAttemptBiometricUnlock({
          isMobileApp: !!appService?.isMobileApp,
          biometricUnlockEnabled,
          available,
        })
      ) {
        setBiometricBusy(false);
        return;
      }
      setBiometryLabel(_(getBiometryLabelKey(biometryType)));
      // Already attempted (the effect can re-run): leave `biometricBusy`
      // to `runBiometric`'s own finally so a re-run can't reveal the PIN
      // while the first attempt's native sheet is still in flight.
      if (biometricAttemptedRef.current) return;
      biometricAttemptedRef.current = true;
      await runBiometric();
    })();
    return () => {
      cancelled = true;
    };
  }, [appService]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const layoutH = document.documentElement.clientHeight;
      const offset = layoutH - vv.height - vv.offsetTop;
      setKbInset(offset > 1 ? offset : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  // Avoid React state for the in-flight guard — `setVerifying(true)`
  // would re-trigger the effect, the cleanup would set `cancelled=true`,
  // and the resolve handler would short-circuit before clearing the
  // failed PIN. A ref keeps the guard outside the render cycle.
  const verifyingRef = useRef(false);

  const handleChange = async (next: string) => {
    setPin(next);
    if (error) setError('');
    if (next.length !== PIN_LENGTH || verifyingRef.current) return;
    if (!pinHash || !pinSalt) {
      // Settings flag is enabled but the hash/salt are missing — treat
      // as a corrupted-config bypass so the user isn't locked out
      // forever. This should be unreachable through normal flows.
      unlock();
      return;
    }
    verifyingRef.current = true;
    try {
      const ok = await verifyPin(next, pinSalt, pinHash);
      if (ok) {
        unlock();
      } else {
        setError(_('Incorrect PIN'));
        setPin('');
        setShaking(true);
        window.setTimeout(() => setShaking(false), 400);
      }
    } finally {
      verifyingRef.current = false;
    }
  };

  return (
    <div
      className='bg-base-100 full-height inset-0 z-[200] flex flex-col items-center justify-center px-6'
      style={{ paddingBottom: kbInset || undefined }}
      role='dialog'
      aria-modal='true'
      aria-label={_('App locked')}
    >
      {!biometricBusy && (
        <div className='flex max-w-sm flex-col items-center text-center'>
          <h1 className='text-base-content mb-2 text-xl font-semibold tracking-tight'>
            {_('Enter your PIN')}
          </h1>
          <p className='text-base-content/60 mb-8 text-sm leading-relaxed'>
            {_('Readest is locked. Enter your 4-digit PIN to continue.')}
          </p>

          <PinInput
            value={pin}
            onChange={handleChange}
            ariaLabel={_('PIN code')}
            stickyFocus={autoFocusEnabled}
            shake={shaking}
          />

          <p
            className={clsx(
              'text-error mt-4 h-5 text-sm transition-opacity',
              error ? 'opacity-100' : 'opacity-0',
            )}
            aria-live='polite'
          >
            {error || ' '}
          </p>

          {biometryLabel && (
            <button
              type='button'
              onClick={runBiometric}
              className={clsx(
                'eink-bordered',
                'mt-2 h-10 rounded-lg px-4 text-sm font-medium',
                'text-base-content hover:bg-base-200 transition-colors duration-150',
              )}
            >
              {_('Use {{biometry}}', { biometry: biometryLabel })}
            </button>
          )}

          <p className='text-base-content/40 mt-10 text-xs leading-relaxed'>
            {_(
              "Forgetting your PIN locks you out of this device. You'll need to clear the app's data to reset it.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}
