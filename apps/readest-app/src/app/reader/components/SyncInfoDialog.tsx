import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { BookMetadata } from '@/libs/document';
import { formatLocaleDateTime, getMetadataHashInfo } from '@/utils/book';
import { clampSyncTimeForDisplay } from '@/utils/time';
import { useCloudSyncStatus, type CloudSyncProviderStatus } from '@/hooks/useCloudSyncStatus';

interface SyncInfoDialogProps {
  isOpen: boolean;
  metadata: BookMetadata | null | undefined;
  storedMetaHash?: string;
  /**
   * Readest Cloud's own most recent sync for this book, across pull + push of
   * config and notes. Every other provider's timestamp is read from settings by
   * {@link useCloudSyncStatus} — this dialog reports them all separately so a
   * user can see which provider is actually keeping up (#5910).
   */
  nativeLastSyncedAt?: number;
  onClose: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className='flex flex-col gap-1'>
    <span className='text-base-content/60 text-sm uppercase tracking-wide sm:text-xs'>{label}</span>
    <div className='bg-base-200 text-base-content/90 break-all rounded-md p-2 font-mono text-sm sm:text-xs'>
      {value}
    </div>
  </div>
);

const SyncInfoDialog: React.FC<SyncInfoDialogProps> = ({
  isOpen,
  metadata,
  storedMetaHash,
  nativeLastSyncedAt,
  onClose,
}) => {
  const _ = useTranslation();
  const syncStatus = useCloudSyncStatus(nativeLastSyncedAt);
  const info = metadata ? getMetadataHashInfo(metadata) : undefined;
  const displayHash = storedMetaHash || info?.metaHash || '';
  const placeholder = _('(none)');
  const providerStatusLabel = (provider: CloudSyncProviderStatus): string =>
    provider.syncing
      ? _('Syncing…')
      : provider.failed
        ? _('Sync failed')
        : provider.lastSyncedAt
          ? formatLocaleDateTime(clampSyncTimeForDisplay(provider.lastSyncedAt))
          : _('Never synced');

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      snapHeight={0.7}
      title={_('Sync Info')}
      boxClassName='sm:min-w-[520px]! sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-3 p-2 sm:p-4'>
          <Row label={_('Book Fingerprint')} value={displayHash || placeholder} />
          <Row label={_('Title')} value={info?.title || placeholder} />
          <Row
            label={_('Author')}
            value={info && info.authors.length > 0 ? info.authors.join(', ') : placeholder}
          />
          <Row
            label={_('Identifiers')}
            value={info && info.identifiers.length > 0 ? info.identifiers.join(', ') : placeholder}
          />
          {/* One row per provider the user actually selected. With a single
              provider the row keeps its original "Last Synced" caption; with
              several, each is named so it is clear whose timestamp is whose. */}
          {syncStatus.providers.length === 0 ? (
            <Row label={_('Last Synced')} value={_('Never synced')} />
          ) : syncStatus.providers.length === 1 ? (
            <Row label={_('Last Synced')} value={providerStatusLabel(syncStatus.providers[0]!)} />
          ) : (
            syncStatus.providers.map((provider) => (
              <Row
                key={provider.kind}
                label={_('Last Synced — {{provider}}', { provider: provider.name })}
                value={providerStatusLabel(provider)}
              />
            ))
          )}
        </div>
      )}
    </Dialog>
  );
};

export default SyncInfoDialog;
