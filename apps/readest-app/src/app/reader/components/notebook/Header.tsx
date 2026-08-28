import clsx from 'clsx';
import React from 'react';

import { RiQuillPenLine } from 'react-icons/ri';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
}> = ({ isPinned, handleClose, handleTogglePin }) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const iconSize18 = useResponsiveSize(18);
  return (
    <div className='notebook-header relative flex h-11 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center space-x-2'>
        <RiQuillPenLine size={iconSize18} />
        <div className='notebook-title text-sm font-medium'>{_('Notebook')}</div>
      </div>
      <div className='flex w-full items-center gap-x-4'>
        <button
          title={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
            isPinned ? 'bg-base-300' : 'bg-base-300/65',
          )}
        >
          {isPinned ? <MdPushPin size={iconSize15} /> : <MdOutlinePushPin size={iconSize15} />}
        </button>
        <button
          title={_('Close')}
          aria-label={_('Close')}
          onClick={handleClose}
          className='btn btn-ghost btn-circle flex h-11 min-h-11 w-11 hover:bg-transparent sm:hidden'
        >
          <MdArrowBackIosNew />
        </button>
      </div>
    </div>
  );
};

export default NotebookHeader;
