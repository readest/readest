import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { MdKeyboardDoubleArrowLeft } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';
import { LuMessageSquare } from 'react-icons/lu';
import { FiBookOpen } from 'react-icons/fi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { setSideBarVisible } = useSidebarStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const tabs = ['reading', 'toc', 'annotations', 'bookmarks', 'history'];

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
        return _('Highlights');
      default:
        return '';
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab border-[#6a4d28]/28 flex w-full border-t bg-[linear-gradient(180deg,rgba(18,12,10,0.98),rgba(10,7,6,0.98))] sm:min-h-0 sm:flex-col sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-3 sm:pt-0',
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
            'citadel-rail-tab group relative m-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-[background-color,color,box-shadow,transform] duration-150 sm:m-0 sm:flex-none sm:rounded-none sm:px-4 sm:py-[14px]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a45a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#160f0d]',
            !aiEnabled && tab === 'history' ? 'citadel-rail-tab-history' : '',
            activeTab === tab ? 'citadel-rail-tab-active' : '',
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
              'pointer-events-none absolute bottom-3 left-[8px] top-3 hidden w-[2px] rounded-full bg-gradient-to-b from-[#d7b06d] via-[#9e4f2c] to-[#7f2e1f] sm:block',
              activeTab === tab ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div className='m-0 flex h-6 items-center p-0 sm:h-auto sm:flex-col sm:gap-2.5'>
            {tab === 'reading' ? (
              <FiBookOpen className='mx-auto text-[18px] sm:text-[23px]' />
            ) : tab === 'toc' ? (
              <IoIosList className='mx-auto text-[18px] sm:text-[23px]' />
            ) : tab === 'annotations' ? (
              <PiNotePencil className='mx-auto text-[18px] sm:text-[23px]' />
            ) : tab === 'bookmarks' ? (
              <MdBookmarkBorder className='mx-auto text-[18px] sm:text-[23px]' />
            ) : (
              <LuMessageSquare className='mx-auto text-[18px] sm:text-[23px]' />
            )}
            <span className='hidden max-w-full text-center text-[8px] font-semibold uppercase leading-[1.14] tracking-[0.12em] sm:block'>
              {getTabLabel(tab)}
            </span>
          </div>
        </div>
      ))}
      <div className='citadel-rail-spacer hidden sm:block' aria-hidden='true' />
      <div className='hidden px-3 pb-2 pt-2 sm:block'>
        <button
          type='button'
          title={_('Collapse Sidebar')}
          aria-label={_('Collapse Sidebar')}
          onClick={() => setSideBarVisible(false)}
          className='citadel-rail-collapse mx-auto flex h-10 w-10 items-center justify-center rounded-full'
        >
          <MdKeyboardDoubleArrowLeft className='text-[19px]' />
        </button>
      </div>
      <style jsx global>{`
        @media (min-width: 640px) {
          .bottom-tab {
            min-height: 100%;
          }

          .citadel-rail-tab {
            min-height: 70px;
            margin: 2px 8px;
            justify-content: center;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 12px;
            color: rgba(218, 184, 120, 0.92);
            box-shadow: none;
            transition:
              background 160ms ease,
              border-color 160ms ease,
              color 160ms ease,
              box-shadow 160ms ease;
          }

          /* Subtle hairline between rail tabs — purely decorative */
          .bottom-tab .citadel-rail-tab + .citadel-rail-tab::before {
            content: '';
            position: absolute;
            top: -1px;
            left: 18%;
            right: 18%;
            height: 1px;
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(162, 124, 60, 0.2) 50%,
              transparent 100%
            );
            pointer-events: none;
          }

          .citadel-rail-tab .m-0 {
            width: 100%;
          }

          .citadel-rail-tab:hover {
            background: rgba(28, 20, 17, 0.32);
            border-color: rgba(168, 124, 64, 0.1);
            color: rgba(234, 200, 132, 0.99);
          }

          .citadel-rail-tab-history {
            color: rgba(218, 184, 120, 0.92);
          }

          .citadel-rail-tab.citadel-rail-tab-active {
            background: linear-gradient(
              180deg,
              rgba(52, 19, 16, 0.26) 0%,
              rgba(28, 14, 12, 0.56) 56%,
              rgba(17, 10, 10, 0.72) 100%
            );
            border-color: rgba(154, 92, 50, 0.14);
            color: rgb(245, 218, 146);
            box-shadow:
              inset 0 1px 0 rgba(255, 220, 156, 0.025),
              inset 0 -1px 0 rgba(0, 0, 0, 0.3);
          }

          .citadel-rail-tab.citadel-rail-tab-active::after {
            content: none;
          }

          .citadel-rail-spacer {
            flex: 1;
            min-height: 32px;
          }

          .citadel-rail-collapse {
            border: 1px solid rgba(182, 144, 76, 0.46);
            background: linear-gradient(180deg, rgba(24, 16, 13, 0.98), rgba(12, 9, 8, 0.99));
            color: rgba(226, 188, 112, 0.96);
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.06),
              inset 0 -1px 0 rgba(0, 0, 0, 0.34),
              0 2px 10px rgba(0, 0, 0, 0.22);
            opacity: 0.98;
            transition:
              background 150ms ease,
              border-color 150ms ease,
              color 150ms ease,
              transform 150ms ease;
          }

          .citadel-rail-collapse:hover {
            border-color: rgba(228, 190, 108, 0.68);
            background: linear-gradient(180deg, rgba(34, 22, 18, 0.98), rgba(16, 12, 10, 0.98));
            color: rgba(242, 214, 140, 0.98);
          }

          .citadel-rail-collapse:focus-visible {
            outline: none;
            box-shadow:
              0 0 0 1px rgba(201, 164, 90, 0.88),
              0 0 0 3px rgba(120, 24, 18, 0.36);
          }
        }
      `}</style>
    </div>
  );
};

export default TabNavigation;
