import clsx from 'clsx';
import React from 'react';

import { RiQuillPenLine } from 'react-icons/ri';
import { MdAdd, MdArrowBackIosNew, MdClose, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  isFullScreenMobile?: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
  handleNewConversation?: () => void;
}> = ({
  isPinned,
  isFullScreenMobile = false,
  handleClose,
  handleTogglePin,
  handleNewConversation,
}) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const iconSize18 = useResponsiveSize(18);
  return (
    <div className='notebook-header relative flex h-14 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center gap-2'>
        <RiQuillPenLine size={iconSize18} />
        <div className='flex flex-col items-start leading-tight'>
          <div className='notebook-title text-sm font-medium'>{_('对话批注')}</div>
          <div className='text-base-content/55 text-[10px]'>{_('未选中文字 · 可直接提问')}</div>
        </div>
      </div>
      <div className='flex w-full items-center justify-between gap-x-2'>
        <div className='flex items-center gap-x-2'>
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
        </div>
        <div className='flex items-center gap-x-1'>
          <button
            type='button'
            title={_('New conversation')}
            aria-label={_('New conversation')}
            onClick={handleNewConversation}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8'
          >
            <MdAdd size={iconSize18} />
          </button>
          <button
            title={_('Close')}
            aria-label={_('Close')}
            onClick={handleClose}
            className={clsx(
              'btn btn-ghost btn-circle flex h-11 min-h-11 w-11 hover:bg-transparent',
              isFullScreenMobile ? 'ml-auto' : 'sm:hidden',
            )}
          >
            {isFullScreenMobile ? <MdClose size={iconSize18} /> : <MdArrowBackIosNew />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotebookHeader;
