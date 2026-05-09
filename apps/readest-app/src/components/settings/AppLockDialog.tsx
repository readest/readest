'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import ModalPortal from '@/components/ModalPortal';
import PinInput, { type PinInputHandle } from '@/components/PinInput';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { PIN_LENGTH, generatePinSalt, hashPin, isValidPin, verifyPin } from '@/libs/crypto/applock';
import { useAppLockStore } from '@/store/appLockStore';
import { useSettingsStore } from '@/store/settingsStore';

const fieldLabelClass = 'text-base-content/70 text-xs font-medium tracking-wide';

/**
 * Always mounted (at Providers level). Reads `dialogMode` from
 * `useAppLockStore`; renders nothing when null. Dialog state lives in
 * the store rather than the SettingsMenu component because that
 * component unmounts the moment its dropdown closes — local state
 * would never make it to a render.
 */
export default function AppLockDialog() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const {
    pinHash,
    pinSalt,
    setPin: setStorePin,
    clearPin,
    dialogMode,
    closeDialog,
  } = useAppLockStore();
  const mode = dialogMode;

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const currentPinRef = useRef<PinInputHandle | null>(null);
  const newPinRef = useRef<PinInputHandle | null>(null);
  const confirmPinRef = useRef<PinInputHandle | null>(null);

  // Reset every field on open so a previous attempt's digits never
  // leak into the next session.
  useEffect(() => {
    if (!mode) return;
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError('');
  }, [mode]);

  // Auto-advance: as soon as a field reaches PIN_LENGTH, move focus
  // to the next field. Saves the user from tabbing.
  const advanceFromCurrent = (next: string) => {
    setCurrentPin(next);
    if (error) setError('');
    if (next.length === PIN_LENGTH && (mode === 'change' || mode === 'set')) {
      newPinRef.current?.focus();
    }
  };
  const advanceFromNew = (next: string) => {
    setNewPin(next);
    if (error) setError('');
    if (next.length === PIN_LENGTH) confirmPinRef.current?.focus();
  };
  const onConfirmChange = (next: string) => {
    setConfirmPin(next);
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !mode) return;
    setError('');

    if (mode === 'set') {
      if (!isValidPin(newPin)) {
        setError(_('PIN must be {{length}} digits', { length: PIN_LENGTH }));
        return;
      }
      if (newPin !== confirmPin) {
        setError(_('PINs do not match'));
        return;
      }
      setBusy(true);
      try {
        const salt = generatePinSalt();
        const hash = await hashPin(newPin, salt);
        await saveSysSettings(envConfig, 'pinCodeSalt', salt);
        await saveSysSettings(envConfig, 'pinCodeHash', hash);
        await saveSysSettings(envConfig, 'pinCodeEnabled', true);
        setStorePin(hash, salt);
        closeDialog();
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === 'change') {
      if (!pinHash || !pinSalt) {
        closeDialog();
        return;
      }
      if (!isValidPin(currentPin)) {
        setError(_('PIN must be {{length}} digits', { length: PIN_LENGTH }));
        return;
      }
      setBusy(true);
      try {
        const ok = await verifyPin(currentPin, pinSalt, pinHash);
        if (!ok) {
          setError(_('Incorrect PIN'));
          setCurrentPin('');
          currentPinRef.current?.focus();
          return;
        }
        if (!isValidPin(newPin)) {
          setError(_('PIN must be {{length}} digits', { length: PIN_LENGTH }));
          return;
        }
        if (newPin !== confirmPin) {
          setError(_('PINs do not match'));
          return;
        }
        const salt = generatePinSalt();
        const hash = await hashPin(newPin, salt);
        await saveSysSettings(envConfig, 'pinCodeSalt', salt);
        await saveSysSettings(envConfig, 'pinCodeHash', hash);
        setStorePin(hash, salt);
        closeDialog();
      } finally {
        setBusy(false);
      }
      return;
    }

    // mode === 'disable'
    if (!pinHash || !pinSalt) {
      closeDialog();
      return;
    }
    if (!isValidPin(currentPin)) {
      setError(_('PIN must be {{length}} digits', { length: PIN_LENGTH }));
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyPin(currentPin, pinSalt, pinHash);
      if (!ok) {
        setError(_('Incorrect PIN'));
        setCurrentPin('');
        currentPinRef.current?.focus();
        return;
      }
      await saveSysSettings(envConfig, 'pinCodeEnabled', false);
      await saveSysSettings(envConfig, 'pinCodeHash', undefined);
      await saveSysSettings(envConfig, 'pinCodeSalt', undefined);
      clearPin();
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  if (!mode) return null;
  // Defensive: if `pinCodeEnabled` is somehow stale relative to the
  // mode the caller asked for, close rather than crash.
  if (mode !== 'set' && !settings.pinCodeEnabled) {
    closeDialog();
    return null;
  }

  const title =
    mode === 'set' ? _('Set PIN') : mode === 'change' ? _('Change PIN') : _('Disable PIN');

  const description =
    mode === 'set'
      ? _(
          'Pick a 4-digit PIN. You will need to enter it every time you open Readest. There is no way to recover a forgotten PIN — clearing the app data is the only way to reset it.',
        )
      : mode === 'change'
        ? _('Enter your current PIN, then choose a new 4-digit PIN.')
        : _('Enter your current PIN to disable the app lock.');

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box bg-base-200 max-w-md rounded-2xl p-6 shadow-2xl'>
          <h3 className='mb-1.5 text-lg font-semibold tracking-tight'>{title}</h3>
          <p className='text-base-content/60 mb-5 text-sm leading-relaxed'>{description}</p>
          <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
            {(mode === 'change' || mode === 'disable') && (
              <div className='flex flex-col items-center gap-2'>
                <span className={fieldLabelClass}>{_('Current PIN')}</span>
                <PinInput
                  ref={currentPinRef}
                  value={currentPin}
                  onChange={advanceFromCurrent}
                  ariaLabel={_('Current PIN')}
                  autoFocus
                  autoComplete='current-password'
                  disabled={busy}
                />
              </div>
            )}
            {(mode === 'set' || mode === 'change') && (
              <>
                <div className='flex flex-col items-center gap-2'>
                  <span className={fieldLabelClass}>{_('New PIN')}</span>
                  <PinInput
                    ref={newPinRef}
                    value={newPin}
                    onChange={advanceFromNew}
                    ariaLabel={_('New PIN')}
                    autoFocus={mode === 'set'}
                    autoComplete='new-password'
                    disabled={busy}
                  />
                </div>
                <div className='flex flex-col items-center gap-2'>
                  <span className={fieldLabelClass}>{_('Confirm new PIN')}</span>
                  <PinInput
                    ref={confirmPinRef}
                    value={confirmPin}
                    onChange={onConfirmChange}
                    ariaLabel={_('Confirm new PIN')}
                    autoComplete='new-password'
                    disabled={busy}
                  />
                </div>
              </>
            )}
            <p
              className={clsx(
                'text-error h-4 text-center text-xs transition-opacity',
                error ? 'opacity-100' : 'opacity-0',
              )}
              aria-live='polite'
            >
              {error || ' '}
            </p>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={closeDialog}
                disabled={busy}
                className='eink-bordered hover:bg-base-300/70 rounded-lg px-4 py-2 text-sm font-medium transition-colors'
              >
                {_('Cancel')}
              </button>
              <button
                type='submit'
                disabled={busy}
                className={clsx(
                  'btn btn-primary text-primary-content hover:bg-primary/90 active:bg-primary/80 rounded-lg border-0 px-4 py-2 text-sm font-medium transition-colors',
                  busy && 'opacity-60',
                )}
              >
                {mode === 'set' ? _('Set PIN') : mode === 'change' ? _('Change PIN') : _('Disable')}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
