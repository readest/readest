import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface NotebookTransitionAlertProps {
  onKeepOpen: () => void;
  onCopy: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}

const NotebookTransitionAlert: React.FC<NotebookTransitionAlertProps> = ({
  onKeepOpen,
  onCopy,
  onDiscard,
  onRetry,
}) => {
  const _ = useTranslation();

  return (
    <div
      role='alertdialog'
      aria-modal='true'
      aria-labelledby='notebook-save-failed-title'
      className='modal-box eink-bordered bg-base-100 flex max-w-lg flex-col gap-4'
    >
      <div className='flex flex-col gap-1'>
        <h2 id='notebook-save-failed-title' className='text-base font-semibold'>
          {_('Notebook could not be saved')}
        </h2>
        <p className='text-base-content/75 text-sm'>
          {_(
            'Readest could not save this Notebook or create a local recovery copy. Keep the book open, retry, copy the draft, or discard it before continuing.',
          )}
        </p>
      </div>
      <div className='flex flex-wrap items-center justify-end gap-2' dir='ltr'>
        <button type='button' className='eink-bordered btn btn-ghost btn-sm' onClick={onKeepOpen}>
          {_('Keep open')}
        </button>
        <button type='button' className='eink-bordered btn btn-ghost btn-sm' onClick={onCopy}>
          {_('Copy draft')}
        </button>
        <button type='button' className='btn btn-warning btn-sm' onClick={onDiscard}>
          {_('Discard & Continue')}
        </button>
        <button type='button' className='btn btn-contrast btn-sm' onClick={onRetry} autoFocus>
          {_('Retry')}
        </button>
      </div>
    </div>
  );
};

export default NotebookTransitionAlert;
