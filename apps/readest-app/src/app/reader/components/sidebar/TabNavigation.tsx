import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder as BookmarkIcon } from 'react-icons/md';
import { IoIosList as TOCIcon } from 'react-icons/io';
import { PiNotePencil as NoteIcon } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const tabs = ['toc', 'annotations', 'bookmarks'];

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 relative flex w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
      )}
      dir='ltr'
    >
      <div
        className={clsx(
          'bg-base-300/85 absolute bottom-1.5 start-1 z-10 h-[calc(100%-12px)] w-[calc(33.3%-8px)] rounded-lg',
          'transform transition-transform duration-300',
          activeTab === 'toc' && 'translate-x-0',
          activeTab === 'annotations' && 'translate-x-[calc(100%+8px)]',
          activeTab === 'bookmarks' && 'translate-x-[calc(200%+16px)]',
        )}
      />
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className='z-[11] m-1.5 flex-1 cursor-pointer rounded-md p-2'
          onClick={() => onTabChange(tab)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab);
            }
          }}
          title={tab === 'toc' ? _('TOC') : tab === 'annotations' ? _('Annotate') : _('Bookmark')}
          aria-label={
            tab === 'toc' ? _('TOC') : tab === 'annotations' ? _('Annotate') : _('Bookmark')
          }
        >
          <div className={clsx('m-0 flex h-6 items-center p-0')}>
            {tab === 'toc' ? (
              <TOCIcon className='mx-auto' />
            ) : tab === 'annotations' ? (
              <NoteIcon className='mx-auto' />
            ) : (
              <BookmarkIcon className='mx-auto' />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
