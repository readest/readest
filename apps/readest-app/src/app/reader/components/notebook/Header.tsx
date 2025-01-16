import clsx from 'clsx';
import React from 'react';

import { FiSearch } from 'react-icons/fi';
import { LuNotebookPen } from 'react-icons/lu';
import { MdOutlinePushPin, MdPushPin } from 'react-icons/md';
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
        <LuNotebookPen size={14} />
        <div className='notebook-title text-sm font-medium'>{_('Notebook')}</div>
      </div>
      <div className='z-10 flex items-center gap-x-3'>
        <button
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
            isPinned ? 'bg-base-300' : 'bg-base-300/65',
          )}
        >
          {isPinned ? <MdPushPin size={14} /> : <MdOutlinePushPin size={14} />}
        </button>
        <button
          onClick={handleClose}
          className={'bg-base-300/65 btn btn-ghost btn-circle h-6 min-h-6 w-6 sm:hidden'}
        >
          <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
            <path
              fill='currentColor'
              d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
            />
          </svg>
        </button>
        <button className='btn btn-ghost left-0 h-8 min-h-8 w-8 p-0'>
          <FiSearch size={18} />
        </button>
      </div>
    </div>
  );
};

export default NotebookHeader;
