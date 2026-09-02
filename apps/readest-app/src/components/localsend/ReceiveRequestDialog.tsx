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
 * Cert-verified senders can be paired ("Always accept from this device"):
 * future drops then skip this dialog. The checkbox is hidden entirely for
 * cert-less senders (their fingerprint is spoofable, so they can never be
 * trusted), and shows a Premium badge routing to the upgrade page for users
 * without the pairing entitlement.
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
  // While a signed-in user's plan is still loading, show neither the
  // checkbox nor the badge so nothing flashes.
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const pairingEntitled = isNearbyPairingAllowed(userProfilePlan ?? 'free', customizationPurchased);
  const showPairCheckbox = request.sender.certVerified && pairingEntitled;
  const showPairLocked =
    request.sender.certVerified && !pairingEntitled && (!user || userProfilePlan !== undefined);

  const openUpgrade = () => {
    if (user) {
      navigateToProfile(router);
    } else {
      navigateToLogin(router);
    }
  };

  const totalSize = supported.reduce((sum, file) => sum + file.size, 0);

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
        title={_('{{alias}} wants to send you books', { alias: request.sender.alias })}
        message={_('{{count}} book(s), {{size}}', {
          count: supported.length,
          size: formatBytes(totalSize),
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
          {showPairCheckbox && (
            <label className='mt-1 flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                className='checkbox checkbox-sm eink-bordered'
                checked={pairDevice}
                onChange={(event) => setPairDevice(event.target.checked)}
              />
              <span>{_('Always accept from {{alias}}', { alias: request.sender.alias })}</span>
            </label>
          )}
          {showPairLocked && (
            <button
              type='button'
              className='mt-1 flex items-center gap-2 text-start'
              onClick={openUpgrade}
            >
              <input
                type='checkbox'
                className='checkbox checkbox-sm'
                disabled
                checked={false}
                readOnly
              />
              <span className='text-base-content/70'>
                {_('Always accept from {{alias}}', { alias: request.sender.alias })}
              </span>
              <span className='badge badge-sm badge-ghost shrink-0'>{_('Premium')}</span>
            </button>
          )}
        </div>
      </Alert>
    </div>
  );
};

export default ReceiveRequestDialog;
