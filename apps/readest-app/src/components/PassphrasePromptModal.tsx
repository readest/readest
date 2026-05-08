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
export default function PassphrasePromptModal() {
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

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box max-w-md'>
          <h3 className='mb-2 text-lg font-bold'>
            {isSetup ? _('Set sync passphrase') : _('Enter sync passphrase')}
          </h3>
          <p className='text-base-content/70 mb-4 text-sm'>
            {isSetup
              ? _(
                  'A sync passphrase encrypts your sensitive fields (like OPDS catalog credentials) before they sync. We never see this passphrase. Pick something memorable — there is no recovery without it.',
                )
              : _(
                  'Enter the sync passphrase you set on another device to decrypt your synced credentials.',
                )}
          </p>
          <form onSubmit={handleSubmit} className='space-y-3'>
            <div className='form-control'>
              <input
                ref={inputRef}
                type='password'
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError('');
                }}
                placeholder={_('Sync passphrase')}
                className='input input-bordered w-full'
                autoComplete='new-password'
                required
              />
            </div>
            {isSetup && (
              <div className='form-control'>
                <input
                  type='password'
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError('');
                  }}
                  placeholder={_('Confirm passphrase')}
                  className='input input-bordered w-full'
                  autoComplete='new-password'
                  required
                />
              </div>
            )}
            {error && <div className='text-error text-sm'>{error}</div>}
            <div className='modal-action'>
              <button type='button' className='btn' onClick={() => close(null)}>
                {_('Cancel')}
              </button>
              <button type='submit' className='btn btn-primary'>
                {isSetup ? _('Set passphrase') : _('Unlock')}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
