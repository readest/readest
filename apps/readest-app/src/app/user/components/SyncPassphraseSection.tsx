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

  if (status === 'loading') return null;

  // "Unlock now" lets the user proactively enter the passphrase ahead
  // of an action that needs it (e.g., adding a credentialed catalog
  // right after a hard refresh) so they don't get interrupted by a
  // modal mid-flow. When the session is already unlocked it's a quick
  // no-op that just confirms readiness. The page refresh itself is
  // the "lock this device" action — there's no separate Lock button.
  const handleSetOrUnlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await ensurePassphraseUnlocked();
      await refreshStatus();
      setMessage(_('Sync passphrase ready'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
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
      await refreshStatus();
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
          : _('Set on this account. Will be requested when needed to decrypt synced credentials.')}
      </p>
      {message && <p className='text-base-content/60 mb-3 text-xs'>{message}</p>}
      <div className='flex flex-wrap gap-2'>
        <button className='btn btn-primary btn-sm' disabled={busy} onClick={handleSetOrUnlock}>
          {status === 'unset' ? _('Set passphrase') : _('Unlock now')}
        </button>
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
