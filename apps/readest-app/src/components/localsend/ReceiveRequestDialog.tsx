import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useThemeStore } from '@/store/themeStore';
import { partitionSupportedFiles } from '@/services/localsend/formats';
import { previewDataUrl } from '@/services/localsend/preview';
import type { ReceiveRequest } from '@/services/localsend/types';
import { isNearbyPairingAllowed } from '@/utils/access';
import { formatBytes } from '@/utils/book';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import Alert from '@/components/Alert';
import clsx from 'clsx';

const MAX_LISTED_FILES = 8;

/** Row chassis for the pairing opt-in; `items-start` keeps the box and the
 *  Premium badge on the first line when the label wraps. `pe-0` is load
 *  bearing: the badge is `ms-auto`, so any end padding here would inset it
 *  from the dialog's content edge and break its alignment with the Accept
 *  button below. */
const PAIR_ROW =
  'flex cursor-pointer items-start gap-2 rounded-md ps-1 pe-0 py-2 text-start text-sm';

interface ReceiveRequestDialogProps {
  request: ReceiveRequest;
  onAccept: (fileIds: string[], pairDevice: boolean) => void;
  onDecline: () => void;
}

/**
 * Incoming LocalSend transfer prompt. Lists only the book files Readest can
 * import; other offered files are declined via protocol partial-accept, with
 * a note so the user knows the sender sees the split.
 *
 * Cert-verified senders can be paired via "Always accept from <device>":
 * ticking it makes future drops from that device skip this dialog. The opt-in
 * is hidden entirely for cert-less senders (their fingerprint is spoofable, so
 * they can never be trusted); users without the pairing entitlement see it
 * inert behind a Premium badge that routes to the upgrade page.
 */
const ReceiveRequestDialog: React.FC<ReceiveRequestDialogProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { safeAreaInsets } = useThemeStore();
  const [pairDevice, setPairDevice] = useState(false);
  const { supported, skipped } = useMemo(
    () => partitionSupportedFiles(request.files),
    [request.files],
  );

  // Mirrors the TTS-cache paywall: badge only users who can't pair yet —
  // signed out (known at once), or a resolved plan without the feature.
  // While a signed-in user's plan is still loading, show neither the scope
  // choice nor the badge so nothing flashes.
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const pairingEntitled = isNearbyPairingAllowed(userProfilePlan ?? 'free', customizationPurchased);
  const canPair = request.sender.certVerified && pairingEntitled;
  const pairLocked =
    request.sender.certVerified && !pairingEntitled && (!user || userProfilePlan !== undefined);

  const openUpgrade = () => {
    if (user) {
      navigateToProfile(router);
    } else {
      navigateToLogin(router);
    }
  };

  return (
    <div
      className={clsx(
        // z-[60]: must stack above the device picker (z-50), or an incoming
        // request hides under an open picker sheet and can never be answered.
        'localsend-receive-alert fixed bottom-0 left-0 right-0 z-[60] flex justify-center',
      )}
      style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px` }}
    >
      <Alert
        title={_('{{alias}} wants to send you {{count}} book(s)', {
          alias: request.sender.alias,
          count: supported.length,
        })}
        confirmLabel={_('Accept')}
        confirmButtonClassName='btn-contrast'
        onCancel={onDecline}
        onConfirm={() =>
          onAccept(
            supported.map((file) => file.id),
            pairDevice,
          )
        }
      >
        <div className='flex flex-col gap-1 ps-9 text-sm'>
          {supported.slice(0, MAX_LISTED_FILES).map((file) => {
            const cover = previewDataUrl(file.preview);
            return (
              <div key={file.id} className='flex min-w-0 items-center justify-between gap-3'>
                <span className='flex min-w-0 items-center gap-2'>
                  {cover && (
                    <img
                      src={cover}
                      alt=''
                      className='eink-bordered h-10 w-7 shrink-0 rounded-xs object-cover'
                    />
                  )}
                  <span className='truncate'>{file.fileName}</span>
                </span>
                <span className='text-base-content/60 shrink-0 text-xs'>
                  {formatBytes(file.size)}
                </span>
              </div>
            );
          })}
          {supported.length > MAX_LISTED_FILES && (
            <div className='text-base-content/60 text-xs'>
              {_('and {{count}} more', { count: supported.length - MAX_LISTED_FILES })}
            </div>
          )}
          {skipped.length > 0 && (
            <div className='text-base-content/60 text-xs'>
              {_('{{count}} unsupported file(s) will be skipped', { count: skipped.length })}
            </div>
          )}
          {canPair && (
            <label className={clsx(PAIR_ROW, 'mt-2')}>
              <input
                type='checkbox'
                className='checkbox checkbox-sm eink-bordered mt-0.5 shrink-0'
                checked={pairDevice}
                onChange={(event) => setPairDevice(event.target.checked)}
              />
              <span className='select-none'>
                {_('Always accept from {{alias}}', { alias: request.sender.alias })}
              </span>
            </label>
          )}
          {pairLocked && (
            <button type='button' className={clsx(PAIR_ROW, 'mt-2 w-full')} onClick={openUpgrade}>
              {/* Decorative, never `disabled`: daisyUI drops a disabled box to
                  `opacity: .2` on top of an already 20%-opacity border, which
                  left the control indistinguishable from the surface. Keep it
                  at full opacity with an explicit border and take it out of
                  the tab order instead - the row itself is the control. */}
              <input
                type='checkbox'
                className='checkbox checkbox-sm eink-bordered border-base-content/45 pointer-events-none mt-0.5 shrink-0'
                checked={false}
                readOnly
                tabIndex={-1}
                aria-hidden='true'
              />
              <span className='text-base-content/60 select-none'>
                {_('Always accept from {{alias}}', { alias: request.sender.alias })}
              </span>
              <span className='badge badge-sm badge-ghost ms-auto mt-0.5 shrink-0'>
                {_('Premium')}
              </span>
            </button>
          )}
        </div>
      </Alert>
    </div>
  );
};

export default ReceiveRequestDialog;
