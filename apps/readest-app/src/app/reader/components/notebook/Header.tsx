import clsx from 'clsx';
import React from 'react';

import { FiSearch } from 'react-icons/fi';
import { LuNotebookPen } from 'react-icons/lu';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  isSearchBarVisible: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
  handleToggleSearchBar: () => void;
}> = ({ isPinned, isSearchBarVisible, handleClose, handleTogglePin, handleToggleSearchBar }) => {
  const _ = useTranslation();
  const iconSize14 = useResponsiveSize(14);
  const iconSize18 = useResponsiveSize(18);
  return (
    <div className='notebook-header relative flex h-11 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center space-x-2'>
        <LuNotebookPen size={iconSize18} />
        <div className='notebook-title hidden text-sm font-medium sm:flex'>{_('Notebook')}</div>
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
          {isPinned ? <MdPushPin size={iconSize14} /> : <MdOutlinePushPin size={iconSize14} />}
        </button>
        <button
          title={_('Close')}
          onClick={handleClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew />
        </button>
      </div>
      <div className='flex items-center justify-end gap-x-4'>
        <button
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          onClick={handleToggleSearchBar}
          className={clsx('btn btn-ghost h-8 min-h-8 w-8 p-0', isSearchBarVisible && 'bg-base-300')}
        >
          <FiSearch size={iconSize18} />
        </button>
      </div>
    </div>
  );
};

export default NotebookHeader;
