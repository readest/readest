'use client';

import { useEffect, useRef, useState } from 'react';
import ModalPortal from '@/components/ModalPortal';
import { useTranslation } from '@/hooks/useTranslation';
import { setPassphraseDismisser, setPassphrasePrompter } from '@/services/sync/passphraseGate';
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
 *
 * Submitting doesn't close the dialog — the gate verifies the passphrase
 * against the account's ciphertext first (a PBKDF2 derive, seconds on a
 * phone), and either dismisses us or prompts again with an error. So the
 * modal shows a checking state in between rather than blinking out.
 */
export default function PassphrasePrompt() {
  const _ = useTranslation();
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // `promptError` arrives on a re-prompt: the gate trial-decrypted the
    // previous answer against this account's ciphertext and it didn't verify.
    // It reaches us as the untranslated key (the gate is a non-React module and
    // can only `stubTranslation` it), so the real `_()` has to run here.
    setPassphrasePrompter(({ kind, error: promptError }) => {
      return new Promise<string | null>((resolve) => {
        setValue('');
        setConfirm('');
        setError(promptError ? _(promptError) : '');
        setChecking(false);
        setPending({ kind, resolve });
      });
    });
    setPassphraseDismisser(() => {
      setPending(null);
      setValue('');
      setConfirm('');
      setError('');
      setChecking(false);
    });
    return () => {
      setPassphrasePrompter(null);
      setPassphraseDismisser(null);
    };
    // Re-register when the translator changes (UI language switch) so the
    // retry error isn't rendered by a stale `_`.
  }, [_]);

  useEffect(() => {
    if (pending) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pending]);

  if (!pending) return null;

  const isSetup = pending.kind === 'setup';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (checking) return;
    if (value.length < 8) {
      setError(_('Passphrase must be at least 8 characters'));
      return;
    }
    if (isSetup && value !== confirm) {
      setError(_('Passphrases do not match'));
      return;
    }
    // Hand the answer to the gate and wait: it dismisses us on success, or
    // calls the prompter again with an error if the passphrase was wrong.
    setChecking(true);
    setError('');
    pending.resolve(value);
  };

  // Input pill — modern style for color themes; eink-bordered swaps to
  // 1px border + base-100 bg under [data-eink='true'].
  const inputClass =
    'eink-bordered w-full rounded-xl bg-base-300/60 px-4 py-3 text-sm placeholder:text-base-content/40 ' +
    'border border-transparent transition-colors focus:border-base-content/20 focus:bg-base-300 ' +
    'disabled:opacity-60';

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
              disabled={checking}
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
                disabled={checking}
                required
              />
            )}
            {error && <p className='text-error pt-0.5 text-xs'>{error}</p>}
            <div className='flex justify-end gap-2 pt-4'>
              {/*
               * Cancel: ghost in color themes, eink-bordered (white bg
               * + base-content border) under eink. Submit: btn-contrast —
               * base-content bg + base-100 label, theme-neutral and already
               * e-ink-correct, so the two stay distinct on e-paper without a
               * themed accent colour.
               */}
              <button
                type='button'
                onClick={() => pending.resolve(null)}
                disabled={checking}
                className='eink-bordered hover:bg-base-300/70 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60'
              >
                {_('Cancel')}
              </button>
              <button
                type='submit'
                disabled={checking}
                className='btn btn-contrast rounded-lg px-4 py-2 text-sm font-medium transition-colors'
              >
                {checking && <span className='loading loading-spinner loading-xs' />}
                {isSetup ? _('Set passphrase') : _('Unlock')}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
