import clsx from 'clsx';
import React from 'react';

import { FiSearch } from 'react-icons/fi';
import { LuNotebookPen } from 'react-icons/lu';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
}> = ({ isPinned, handleClose, handleTogglePin }) => {
  const _ = useTranslation();
  return (
    <div className='notebook-header relative flex h-11 items-center px-3'>
      <div className='absolute inset-0 flex items-center justify-center space-x-2'>
        <LuNotebookPen />
        <div className='notebook-title text-sm font-medium'>{_('Notebook')}</div>
      </div>
      <div className='z-10 flex items-center gap-x-4'>
        <button
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
            isPinned ? 'bg-base-300' : 'bg-base-300/65',
          )}
        >
          {isPinned ? <MdPushPin /> : <MdOutlinePushPin />}
        </button>
        <button
          onClick={handleClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew />
        </button>
        <button className='btn btn-ghost left-0 h-8 min-h-8 w-8 p-0'>
          <FiSearch />
        </button>
      </div>
    </div>
  );
};

export default NotebookHeader;
