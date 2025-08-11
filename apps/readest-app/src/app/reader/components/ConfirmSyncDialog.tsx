import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { SyncDetails } from '../hooks/useKOSync';

interface ConfirmSyncDialogProps {
  details: SyncDetails | null;
  onConfirmLocal: () => void;
  onConfirmRemote: () => void;
  onClose: () => void;
}

const ConfirmSyncDialog: React.FC<ConfirmSyncDialogProps> = ({
  details,
  onConfirmLocal,
  onConfirmRemote,
  onClose,
}) => {
  const _ = useTranslation();

  if (!details) return null;

  return (
    <Dialog isOpen={true} onClose={onClose} title={_('Sync Conflict')}>
      <p className='py-4 text-center'>
        {_('Sync reading progress from "{{deviceName}}"?', {
          deviceName: details.remote.device || _('another device'),
        })}
      </p>
      <div className='mt-4 space-y-4'>
        <button className='btn h-auto w-full flex-col items-start py-2' onClick={onConfirmLocal}>
          <span>{_('Local Progress')}</span>
          <span className='text-xs font-normal normal-case text-gray-500'>
            {details.local.preview}
          </span>
        </button>
        <button
          className='btn btn-primary h-auto w-full flex-col items-start py-2'
          onClick={onConfirmRemote}
        >
          <span>{_('Remote Progress')}</span>
          <span className='text-xs font-normal normal-case'>{details.remote.preview}</span>
        </button>
      </div>
    </Dialog>
  );
};

export default ConfirmSyncDialog;
