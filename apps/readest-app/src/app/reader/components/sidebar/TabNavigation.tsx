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
        'bottom-tab border-[#6a4d28]/28 flex w-full border-t bg-[linear-gradient(180deg,rgba(18,12,10,0.98),rgba(10,7,6,0.98))] sm:min-h-0 sm:flex-col sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-4 sm:pt-0',
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
            'citadel-rail-tab group relative m-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-[background-color,color,box-shadow,transform] duration-150 sm:m-0 sm:flex-none sm:rounded-none sm:px-4 sm:py-[18px]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a45a]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#160f0d]',
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
              'pointer-events-none absolute bottom-2 left-0 top-2 hidden w-[4px] rounded-r-full bg-gradient-to-b from-[#f25532] via-[#c63a24] to-[#c29a49] sm:block',
              activeTab === tab ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div className='m-0 flex h-6 items-center p-0 sm:h-auto sm:flex-col sm:gap-3'>
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
            <span className='hidden max-w-full text-center text-[8px] font-semibold uppercase leading-[1.14] tracking-[0.11em] sm:block'>
              {getTabLabel(tab)}
            </span>
          </div>
        </div>
      ))}
      <div className='citadel-rail-spacer hidden sm:block' aria-hidden='true' />
      <style jsx global>{`
        @media (min-width: 640px) {
          .bottom-tab {
            min-height: 100%;
          }

          .citadel-rail-tab {
            min-height: 82px;
            justify-content: center;
            background: linear-gradient(
              180deg,
              rgba(16, 11, 10, 0.06) 0%,
              rgba(7, 6, 6, 0.22) 100%
            );
            border: none;
            border-radius: 0 14px 14px 0;
            color: rgba(153, 119, 66, 0.56);
            box-shadow:
              inset 14px 0 18px rgba(0, 0, 0, 0.16),
              inset 0 1px 0 rgba(255, 237, 193, 0.012);
          }

          .bottom-tab .citadel-rail-tab + .citadel-rail-tab::before {
            content: '';
            position: absolute;
            top: -1px;
            left: 18%;
            right: 14%;
            height: 1px;
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(142, 110, 52, 0.06) 14%,
              rgba(180, 141, 72, 0.16) 50%,
              rgba(142, 110, 52, 0.06) 86%,
              transparent 100%
            );
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.22);
            pointer-events: none;
          }

          .citadel-rail-tab .m-0 {
            width: 100%;
          }

          .citadel-rail-tab:hover {
            background: linear-gradient(
              90deg,
              rgba(46, 18, 14, 0.24) 0%,
              rgba(18, 12, 10, 0.34) 28%,
              rgba(8, 7, 7, 0.18) 100%
            );
            color: rgba(196, 158, 90, 0.84);
          }

          .citadel-rail-tab.citadel-rail-tab-active {
            transform: translateX(1px);
            border-radius: 0 16px 16px 0;
            background: linear-gradient(
              90deg,
              rgba(118, 30, 18, 0.18) 0%,
              rgba(128, 33, 21, 0.62) 10%,
              rgba(102, 29, 18, 0.78) 24%,
              rgba(48, 19, 13, 0.44) 48%,
              rgba(18, 9, 8, 0.1) 72%,
              rgba(18, 9, 8, 0) 100%
            );
            color: rgb(243, 215, 140);
            box-shadow:
              inset 22px 0 62px -12px rgba(236, 74, 26, 0.78),
              inset 0 0 26px rgba(168, 48, 16, 0.14),
              16px 0 30px rgba(132, 28, 18, 0.14);
          }

          .citadel-rail-tab.citadel-rail-tab-active::before {
            content: '';
            position: absolute;
            inset: 8px auto 8px 0;
            width: 18px;
            background:
              linear-gradient(
                180deg,
                rgba(237, 170, 76, 0.55),
                rgba(229, 73, 31, 0.9) 34%,
                rgba(181, 36, 18, 0.84) 100%
              ),
              radial-gradient(circle at 0 50%, rgba(245, 95, 38, 0.42), transparent 90%);
            box-shadow: 0 0 10px rgba(192, 58, 24, 0.26);
            pointer-events: none;
          }

          .citadel-rail-tab.citadel-rail-tab-active::after {
            content: '';
            position: absolute;
            inset: 10px 0 10px auto;
            width: 52%;
            border-radius: 0 14px 14px 0;
            background:
              radial-gradient(circle at 0 50%, rgba(198, 48, 28, 0.22), transparent 44%),
              linear-gradient(90deg, rgba(184, 40, 24, 0.08), transparent);
            pointer-events: none;
          }

          .citadel-rail-spacer {
            flex: 1;
            min-height: 186px;
          }
        }
      `}</style>
    </div>
  );
};

export default TabNavigation;
