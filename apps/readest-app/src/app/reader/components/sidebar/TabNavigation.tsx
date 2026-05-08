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
        return _('Bookmarks');
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
              'pointer-events-none absolute left-[8px] hidden w-[2px] sm:block',
              activeTab === tab ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              top: '50%',
              height: '34px',
              transform: 'translateY(-50%)',
              borderRadius: '999px',
              background: 'rgba(239, 76, 45, 0.95)',
            }}
          />
          <div className='m-0 flex h-6 items-center p-0 sm:h-auto sm:flex-col sm:gap-[10px]'>
            {tab === 'reading' ? (
              <FiBookOpen className='mx-auto text-[18px] sm:text-[24px]' />
            ) : tab === 'toc' ? (
              <IoIosList className='mx-auto text-[18px] sm:text-[24px]' />
            ) : tab === 'annotations' ? (
              <PiNotePencil className='mx-auto text-[18px] sm:text-[24px]' />
            ) : tab === 'bookmarks' ? (
              <MdBookmarkBorder className='mx-auto text-[18px] sm:text-[24px]' />
            ) : (
              <LuMessageSquare className='mx-auto text-[18px] sm:text-[24px]' />
            )}
            <span className='hidden max-w-full text-center text-[8.5px] font-semibold uppercase leading-[1.14] tracking-[0.13em] sm:block'>
              {getTabLabel(tab)}
            </span>
          </div>
        </div>
      ))}
      <div className='citadel-rail-spacer hidden sm:block' aria-hidden='true' />
      <div className='hidden px-0 pb-0 pt-0 sm:block'>
        <button
          type='button'
          title={_('Collapse Sidebar')}
          aria-label={_('Collapse Sidebar')}
          onClick={() => setSideBarVisible(false)}
          className='citadel-rail-collapse mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full'
        >
          <MdKeyboardDoubleArrowLeft className='text-[20px]' />
        </button>
      </div>
      <style jsx global>{`
        @media (min-width: 640px) {
          .bottom-tab {
            min-height: 100%;
            border-top: 0 !important;
            background: transparent !important;
          }

          .citadel-rail-tab {
            min-height: 72px;
            margin: 0 8px 2px;
            justify-content: center;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 12px;
            color: rgba(218, 178, 96, 0.88);
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
            left: 50%;
            width: 62px;
            transform: translateX(-50%);
            height: 1px;
            background: rgba(170, 132, 66, 0.28);
            pointer-events: none;
          }

          .citadel-rail-tab .m-0 {
            width: 100%;
          }

          .citadel-rail-tab svg {
            color: rgba(218, 178, 96, 0.88);
          }

          .citadel-rail-tab span {
            color: rgba(218, 178, 96, 0.82);
          }

          .citadel-rail-tab:hover {
            background: rgba(31, 22, 19, 0.18);
            border-color: transparent;
            color: rgba(232, 190, 108, 0.94);
          }

          .citadel-rail-tab-history {
            color: rgba(218, 178, 96, 0.88);
          }

          .citadel-rail-tab.citadel-rail-tab-active {
            background: linear-gradient(180deg, rgba(58, 20, 15, 0.62), rgba(26, 12, 10, 0.7));
            border: 1px solid rgba(160, 72, 42, 0.26);
            color: rgba(246, 207, 126, 0.96);
            box-shadow: none;
          }

          .citadel-rail-tab.citadel-rail-tab-active::after {
            content: none;
          }

          .citadel-rail-tab.citadel-rail-tab-active svg,
          .citadel-rail-tab.citadel-rail-tab-active span {
            color: rgba(246, 207, 126, 0.96);
          }

          .citadel-rail-spacer {
            flex: 1;
            min-height: 0;
          }

          .citadel-rail-collapse {
            position: relative;
            z-index: 2;
            border: 1px solid rgba(207, 164, 84, 0.72);
            background-color: rgba(35, 29, 25, 0.98);
            background-image: linear-gradient(180deg, rgba(35, 29, 25, 0.98), rgba(16, 13, 12, 1));
            color: rgba(246, 207, 126, 0.98);
            box-shadow:
              inset 0 1px 0 rgba(255, 220, 140, 0.12),
              0 0 14px rgba(196, 130, 50, 0.12);
            opacity: 1;
            transition:
              background 150ms ease,
              border-color 150ms ease,
              color 150ms ease,
              transform 150ms ease;
          }

          .citadel-rail-collapse:hover {
            border-color: rgba(228, 190, 108, 0.8);
            background-image: linear-gradient(180deg, rgba(43, 35, 30, 0.98), rgba(18, 14, 13, 1));
            color: rgba(246, 207, 126, 0.98);
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
