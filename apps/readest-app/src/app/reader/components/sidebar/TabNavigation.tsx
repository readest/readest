import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder as BookmarkIcon } from 'react-icons/md';
import { IoIosList as TOCIcon } from 'react-icons/io';
import { PiNotePencil as NoteIcon, PiRobot as AIIcon } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const tabs = ['toc', 'annotations', 'bookmarks', 'ai'];

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
      )}
      dir='ltr'
    >
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'm-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-colors duration-200',
            activeTab === tab && 'bg-base-300/85',
          )}
          onClick={() => onTabChange(tab)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab);
            }
          }}
          title={
            tab === 'toc'
              ? _('TOC')
              : tab === 'annotations'
                ? _('Annotate')
                : tab === 'bookmarks'
                  ? _('Bookmark')
                  : _('AI')
          }
          aria-label={
            tab === 'toc'
              ? _('TOC')
              : tab === 'annotations'
                ? _('Annotate')
                : tab === 'bookmarks'
                  ? _('Bookmark')
                  : _('AI')
          }
        >
          <div className='m-0 flex h-6 items-center p-0'>
            {tab === 'toc' ? (
              <TOCIcon className='mx-auto' />
            ) : tab === 'annotations' ? (
              <NoteIcon className='mx-auto' />
            ) : tab === 'bookmarks' ? (
              <BookmarkIcon className='mx-auto' />
            ) : (
              <AIIcon className='mx-auto' />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
