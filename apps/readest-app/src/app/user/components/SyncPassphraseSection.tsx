'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cryptoSession } from '@/libs/crypto/session';
import { ensurePassphraseUnlocked } from '@/services/sync/passphraseGate';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import { isSyncError } from '@/libs/errors';

type SyncPassphraseStatus = 'loading' | 'unset' | 'set' | 'error';

const isAuthError = (err: unknown): boolean => isSyncError(err) && err.code === 'AUTH';

export function SyncPassphraseSection() {
  const _ = useTranslation();
  const [status, setStatus] = useState<SyncPassphraseStatus>('loading');
  const [unlocked, setUnlocked] = useState(cryptoSession.isUnlocked());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = async () => {
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
    void refreshStatus();
  }, []);

  // Reflect lock/unlock state changes (the gate flips it during prompt).
  useEffect(() => {
    const interval = setInterval(() => setUnlocked(cryptoSession.isUnlocked()), 500);
    return () => clearInterval(interval);
  }, []);

  if (status === 'loading') return null;

  const handleSetOrUnlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await ensurePassphraseUnlocked();
      await refreshStatus();
      setUnlocked(true);
      setMessage(_('Sync passphrase ready'));
    } catch (err) {
      // User cancelled or backend error — surface the message.
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLock = () => {
    cryptoSession.lock();
    setUnlocked(false);
    setMessage(_('Sync passphrase locked on this device'));
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
      await refreshStatus();
      setUnlocked(false);
      setMessage(_('Sync passphrase forgotten — all encrypted fields cleared'));
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
              'Encrypts sensitive synced fields (like OPDS catalog credentials) before they leave your device. Set one now or wait — it will be requested when needed.',
            )
          : unlocked
            ? _('Set on this account. Unlocked on this device.')
            : _('Set on this account. Locked on this device — set or unlock to sync credentials.')}
      </p>
      {message && <p className='text-base-content/60 mb-3 text-xs'>{message}</p>}
      <div className='flex flex-wrap gap-2'>
        {status === 'unset' || !unlocked ? (
          <button className='btn btn-primary btn-sm' disabled={busy} onClick={handleSetOrUnlock}>
            {status === 'unset' ? _('Set passphrase') : _('Unlock')}
          </button>
        ) : (
          <button className='btn btn-sm' disabled={busy} onClick={handleLock}>
            {_('Lock on this device')}
          </button>
        )}
        {status === 'set' && (
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
