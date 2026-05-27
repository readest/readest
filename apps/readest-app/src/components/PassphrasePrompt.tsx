'use client';

import { useEffect, useRef, useState } from 'react';
import ModalPortal from '@/components/ModalPortal';
import { useTranslation } from '@/hooks/useTranslation';
import { setPassphrasePrompter } from '@/services/sync/passphraseGate';
import type { PassphrasePromptKind } from '@/services/sync/passphraseGate';

interface PendingPrompt {
  kind: PassphrasePromptKind;
  resolve: (passphrase: string | null) => void;
}

/**
 * Singleton passphrase prompt for the encrypted-fields flow. Mount
 * once at the app root. Registers itself with the passphrase gate;
 * any caller that invokes `ensurePassphraseUnlocked` causes this
 * modal to render and resolve with the entered passphrase (or null
 * on cancel).
 */
export default function PassphrasePrompt() {
  const _ = useTranslation();
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPassphrasePrompter(({ kind }) => {
      return new Promise<string | null>((resolve) => {
        setValue('');
        setConfirm('');
        setError('');
        setPending({ kind, resolve });
      });
    });
    return () => setPassphrasePrompter(null);
  }, []);

  useEffect(() => {
    if (pending) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pending]);

  if (!pending) return null;

  const isSetup = pending.kind === 'setup';

  const close = (passphrase: string | null) => {
    pending.resolve(passphrase);
    setPending(null);
    setValue('');
    setConfirm('');
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.length < 8) {
      setError(_('Passphrase must be at least 8 characters'));
      return;
    }
    if (isSetup && value !== confirm) {
      setError(_('Passphrases do not match'));
      return;
    }
    close(value);
  };

  // Input pill — modern style for color themes; eink-bordered swaps to
  // 1px border + base-100 bg under [data-eink='true'].
  const inputClass =
    'eink-bordered w-full rounded-xl bg-base-300/60 px-4 py-3 text-sm placeholder:text-base-content/40 ' +
    'border border-transparent transition-colors focus:border-base-content/20 focus:bg-base-300';

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box bg-base-200 max-w-md rounded-2xl p-6 shadow-2xl'>
          <h3 className='mb-1.5 text-lg font-semibold tracking-tight'>
            {isSetup ? _('Set sync passphrase') : _('Enter sync passphrase')}
          </h3>
          <p className='text-base-content/60 mb-5 text-sm leading-relaxed'>
            {isSetup
              ? _(
                  'A sync passphrase encrypts your sensitive fields (like OPDS catalog credentials) before they sync. We never see this passphrase. Pick something memorable — there is no recovery without it.',
                )
              : _(
                  'Enter the sync passphrase you set on another device to decrypt your synced credentials.',
                )}
          </p>
          <form onSubmit={handleSubmit} className='space-y-2.5'>
            <input
              ref={inputRef}
              type='password'
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
              placeholder={_('Sync passphrase')}
              className={inputClass}
              autoComplete='new-password'
              required
            />
            {isSetup && (
              <input
                type='password'
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError('');
                }}
                placeholder={_('Confirm passphrase')}
                className={inputClass}
                autoComplete='new-password'
                required
              />
            )}
            {error && <p className='text-error pt-0.5 text-xs'>{error}</p>}
            <div className='flex justify-end gap-2 pt-4'>
              {/*
               * Cancel: ghost in color themes, eink-bordered (white bg
               * + base-content border) under eink. Submit: bg-primary
               * in color themes, picks up the existing
               * `[data-eink] .btn-primary` rule (inverted to
               * base-content bg + base-100 text) under eink — so the
               * two buttons stay visually distinct on e-paper.
               */}
              <button
                type='button'
                onClick={() => close(null)}
                className='eink-bordered hover:bg-base-300/70 rounded-lg px-4 py-2 text-sm font-medium transition-colors'
              >
                {_('Cancel')}
              </button>
              <button
                type='submit'
                className='btn btn-primary text-primary-content hover:bg-primary/90 active:bg-primary/80 rounded-lg border-0 px-4 py-2 text-sm font-medium transition-colors'
              >
                {isSetup ? _('Set passphrase') : _('Unlock')}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
