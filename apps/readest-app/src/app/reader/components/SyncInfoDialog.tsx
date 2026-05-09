import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { BookMetadata } from '@/libs/document';
import { formatLocaleDateTime, getMetadataHashInfo } from '@/utils/book';

interface SyncInfoDialogProps {
  isOpen: boolean;
  metadata: BookMetadata | null | undefined;
  storedMetaHash?: string;
  /** Most recent sync timestamp across pull + push of config and notes. */
  lastSyncedAt?: number;
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
  lastSyncedAt,
  onClose,
}) => {
  const _ = useTranslation();
  const info = metadata ? getMetadataHashInfo(metadata) : undefined;
  const displayHash = storedMetaHash || info?.metaHash || '';
  const placeholder = _('(none)');
  const lastSyncedLabel = lastSyncedAt ? formatLocaleDateTime(lastSyncedAt) : _('Never synced');

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      snapHeight={0.7}
      title={_('Sync Info')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
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
          <Row label={_('Last Synced')} value={lastSyncedLabel} />
        </div>
      )}
    </Dialog>
  );
};

export default SyncInfoDialog;
