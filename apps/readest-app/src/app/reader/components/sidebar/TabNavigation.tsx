import clsx from 'clsx';
import React from 'react';
import { MdToc, MdEditNote, MdBookmarkBorder } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();

  const tabs = ['toc', 'annotations', 'bookmarks'];

  return (
    <div className='bottom-tab border-base-300/50 relative flex w-full border-t'>
      <div
        className={clsx(
          'bg-base-300 absolute bottom-1.5 left-1 -z-10 h-[calc(100%-12px)] w-[calc(33.3%-8px)] rounded-lg',
          'transform transition-transform duration-300',
          activeTab === 'toc' && 'translate-x-0',
          activeTab === 'annotations' && 'translate-x-[calc(100%+8px)]',
          activeTab === 'bookmarks' && 'translate-x-[calc(200%+16px)]',
        )}
      />
      {tabs.map((tab) => (
        <div
          key={tab}
          className='lg:tooltip lg:tooltip-top z-50 m-1.5 flex-1 cursor-pointer rounded-md p-2'
          data-tip={
            tab === 'toc'
              ? _('Table of Contents')
              : tab === 'annotations'
                ? _('Annotate')
                : _('Bookmark')
          }
        >
          <div className={clsx('')} onClick={() => onTabChange(tab)}>
            {tab === 'toc' ? (
              <MdToc className='mx-auto' />
            ) : tab === 'annotations' ? (
              <MdEditNote className='mx-auto' />
            ) : (
              <MdBookmarkBorder className='mx-auto' />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
