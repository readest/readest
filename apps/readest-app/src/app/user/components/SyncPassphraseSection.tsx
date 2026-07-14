'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cryptoSession } from '@/libs/crypto/session';
import { clearVerificationSample, ensurePassphraseUnlocked } from '@/services/sync/passphraseGate';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import { isSyncError } from '@/libs/errors';
import { useSettingsStore } from '@/store/settingsStore';

type SyncPassphraseStatus = 'loading' | 'unset' | 'set' | 'error';

const isAuthError = (err: unknown): boolean => isSyncError(err) && err.code === 'AUTH';

export function SyncPassphraseSection() {
  const _ = useTranslation();
  // Tied to the 'credentials' Manage Sync toggle. When credentials sync
  // is off (the default), the passphrase machinery has no purpose — the
  // user has explicitly opted out of sending sensitive fields, so set/
  // forget controls just confuse. Subscribing means the panel pops in /
  // out reactively when the toggle flips.
  const credentialsSync = useSettingsStore(
    (state) => state.settings?.syncCategories?.credentials === true,
  );
  const [status, setStatus] = useState<SyncPassphraseStatus>('loading');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = async () => {
    setUnlocked(cryptoSession.isUnlocked());
    try {
      const rows = await replicaSyncClient.listReplicaKeys();
      setStatus(rows.length === 0 ? 'unset' : 'set');
      setMessage(null);
    } catch (err) {
      if (isAuthError(err)) {
        // Not signed in — hide the panel by leaving status as 'loading'
        // until the auth context re-renders.
        return;
      }
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!credentialsSync) return;
    void refreshStatus();
  }, [credentialsSync]);

  // Credentials sync off → no passphrase UI at all (set / enter / forget /
  // status indicator are all hidden).
  if (!credentialsSync) return null;
  if (status === 'loading') return null;

  /**
   * The manual way in. Without it, a device that holds the wrong passphrase
   * has no recovery: the pull sees an "unlocked" session, never prompts, and
   * just fails to decrypt. `invalidate` throws away whatever this device is
   * holding (including the copy in the OS keychain) so the prompt asks again
   * from scratch and verifies the answer before accepting it.
   */
  const handleSetOrEnter = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await ensurePassphraseUnlocked({ invalidate: unlocked });
      await refreshStatus();
      setMessage(_('Sync passphrase ready'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setUnlocked(cryptoSession.isUnlocked());
    } finally {
      setBusy(false);
    }
  };

  const handleForget = async () => {
    if (
      !confirm(
        _(
          'This permanently deletes the encrypted credentials we sync (e.g., OPDS catalog passwords) on every device. Local copies are preserved. You will need to re-enter the sync passphrase or set a new one. Continue?',
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await cryptoSession.forget();
      clearVerificationSample();
      await refreshStatus();
      setMessage(_('Sync passphrase forgotten. All encrypted fields cleared.'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className='border-base-300 rounded-lg border p-4 text-sm'>
      <h3 className='mb-2 font-semibold'>{_('Sync passphrase')}</h3>
      <p className='text-base-content/70 mb-3'>
        {status === 'unset'
          ? _(
              'Sensitive synced fields are encrypted before upload. Set a passphrase now or later when encryption is needed.',
            )
          : unlocked
            ? _('Unlocked on this device. Your synced credentials are being decrypted.')
            : _('Set on this account. Enter it on this device to decrypt your synced credentials.')}
      </p>
      {message && <p className='text-base-content/60 mb-3 text-xs'>{message}</p>}
      <div className='flex flex-wrap gap-2'>
        <button className='btn btn-contrast btn-sm' disabled={busy} onClick={handleSetOrEnter}>
          {status === 'unset'
            ? _('Set passphrase')
            : unlocked
              ? _('Re-enter passphrase')
              : _('Enter passphrase')}
        </button>
        {status !== 'unset' && (
          <button
            className='btn btn-error btn-outline btn-sm'
            disabled={busy}
            onClick={handleForget}
          >
            {_('Forgot passphrase')}
          </button>
        )}
      </div>
    </section>
  );
}
