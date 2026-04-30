import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';
import { LuMessageSquare } from 'react-icons/lu';
import { FiBookOpen } from 'react-icons/fi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const tabs = ['reading', 'toc', 'annotations', 'bookmarks', ...(aiEnabled ? ['history'] : [])];

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case 'reading':
        return _('Reading');
      case 'toc':
        return _('Contents');
      case 'annotations':
        return _('Notes');
      case 'bookmarks':
        return _('Bookmark');
      case 'history':
        return _('History');
      default:
        return '';
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200 flex w-full border-t sm:min-h-0 sm:flex-col sm:border-t-0 sm:bg-transparent sm:px-2 sm:pb-4',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
      )}
      dir='ltr'
    >
      <div className='pointer-events-none hidden px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8d6f3e] sm:block'>
        Reading
      </div>
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'group relative m-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-colors duration-200 sm:m-0 sm:mb-2 sm:flex-none sm:overflow-hidden sm:px-3 sm:py-2 sm:text-[#a9874b]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a45a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#160f0d]',
            activeTab === tab &&
              'bg-base-300/85 sm:bg-[#321612]/90 sm:text-[#f1d58a] sm:shadow-[0_0_24px_rgba(126,31,25,0.35)]',
          )}
          onClick={() => onTabChange(tab)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTabChange(tab);
            }
          }}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
        >
          <div
            className={clsx(
              'pointer-events-none absolute bottom-2 left-0 top-2 hidden w-0.5 rounded-full bg-gradient-to-b from-[#b73a2f] to-[#c9a45a] sm:block',
              activeTab === tab ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div className='m-0 flex h-6 items-center p-0 sm:h-auto sm:flex-col sm:gap-1'>
            {tab === 'reading' ? (
              <FiBookOpen className='mx-auto text-lg' />
            ) : tab === 'toc' ? (
              <IoIosList className='mx-auto text-lg' />
            ) : tab === 'annotations' ? (
              <PiNotePencil className='mx-auto text-lg' />
            ) : tab === 'bookmarks' ? (
              <MdBookmarkBorder className='mx-auto text-lg' />
            ) : (
              <LuMessageSquare className='mx-auto text-lg' />
            )}
            <span className='hidden max-w-full truncate text-[11px] font-medium sm:block'>
              {getTabLabel(tab)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
