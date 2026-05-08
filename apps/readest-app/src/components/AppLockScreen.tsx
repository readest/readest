'use client';

import clsx from 'clsx';
import { useRef, useState } from 'react';

import PinInput from '@/components/PinInput';
import { PIN_LENGTH, verifyPin } from '@/libs/crypto/applock';
import { useAppLockStore } from '@/store/appLockStore';
import { useTranslation } from '@/hooks/useTranslation';

export default function AppLockScreen() {
  const _ = useTranslation();
  const { pinHash, pinSalt, unlock } = useAppLockStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
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
      className='bg-base-100 fixed inset-0 z-[200] flex flex-col items-center justify-center px-6'
      role='dialog'
      aria-modal='true'
      aria-label={_('App locked')}
    >
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
          stickyFocus
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

        <p className='text-base-content/40 mt-10 text-xs leading-relaxed'>
          {_(
            "Forgetting your PIN locks you out of this device. You'll need to clear the app's data to reset it.",
          )}
        </p>
      </div>
    </div>
  );
}
