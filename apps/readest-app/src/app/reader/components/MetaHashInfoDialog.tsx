import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { BookMetadata } from '@/libs/document';
import { getMetadataHashInfo } from '@/utils/book';

interface MetaHashInfoDialogProps {
  isOpen: boolean;
  metadata: BookMetadata | null | undefined;
  storedMetaHash?: string;
  onClose: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className='flex flex-col gap-1'>
    <span className='text-base-content/60 text-xs uppercase tracking-wide'>{label}</span>
    <div className='bg-base-200 text-base-content/90 break-all rounded-md p-2 font-mono text-xs'>
      {value}
    </div>
  </div>
);

const MetaHashInfoDialog: React.FC<MetaHashInfoDialogProps> = ({
  isOpen,
  metadata,
  storedMetaHash,
  onClose,
}) => {
  const _ = useTranslation();
  const info = metadata ? getMetadataHashInfo(metadata) : undefined;
  const displayHash = storedMetaHash || info?.metaHash || '';
  const hashesMatch = !info || !storedMetaHash || storedMetaHash === info.metaHash;
  const placeholder = _('(none)');

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Metadata Hash')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-3 p-2 sm:p-4'>
          <Row label={_('Meta Hash')} value={displayHash || placeholder} />
          {!hashesMatch && info && <Row label={_('Computed Hash')} value={info.metaHash} />}
          <Row label={_('Title')} value={info?.title || placeholder} />
          <Row
            label={_('Author')}
            value={info && info.authors.length > 0 ? info.authors.join(', ') : placeholder}
          />
          <Row
            label={_('Identifiers')}
            value={info && info.identifiers.length > 0 ? info.identifiers.join(', ') : placeholder}
          />
        </div>
      )}
    </Dialog>
  );
};

export default MetaHashInfoDialog;
