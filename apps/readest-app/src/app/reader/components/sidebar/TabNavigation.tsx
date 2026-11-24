import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';
import { LuMessageSquare } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { isForcedMobileLayout } from '../../utils/mobileLayout';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const isIPhoneDuo = useThemeStore((s) => s.isIPhoneDuo);
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const forceMobileLayout = isForcedMobileLayout(appService?.isMobile, isIPhoneDuo);
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  // The footer bar's desktop layout (`sm:h-[52px]`) depends on width alone.
  const besideDesktopFooter = !forceMobileLayout && window.innerWidth >= 640;
  const tabs = ['toc', 'annotations', 'bookmarks', ...(aiEnabled ? ['history'] : [])];

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case 'toc':
        return _('TOC');
      case 'annotations':
        return _('Annotate');
      case 'bookmarks':
        return _('Bookmark');
      case 'history':
        return _('Chat');
      default:
        return '';
    }
  };

  // On e-ink the bar's top rule sits beside the footer bar's, so it takes the
  // footer's 52px and centers the icons, which the active tab's outline would
  // otherwise push down.
  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200 flex w-full border-t',
        'eink:border-base-content eink:bg-base-100',
        appService?.hasRoundedWindow && 'rounded-window-bottom-left',
        isMobile && 'h-[65px]',
        besideDesktopFooter && 'eink:h-[52px]',
      )}
      dir='ltr'
    >
      {tabs.map((tab) => (
        <div
          key={tab}
          tabIndex={0}
          role='button'
          className={clsx(
            'flex-1 m-1.5 cursor-pointer rounded-lg transition-colors duration-200',
            'eink:flex eink:items-center eink:justify-center eink:py-0',
            activeTab === tab && 'bg-base-300/85 eink-bordered',
            isMobile ? 'p-3' : 'p-2',
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
          aria-pressed={activeTab === tab}
        >
          <div className={clsx('flex h-6 items-center p-0', isMobile ? 'm-0.5' : 'm-0')}>
            {tab === 'toc' ? (
              <IoIosList className='mx-auto' />
            ) : tab === 'annotations' ? (
              <PiNotePencil className='mx-auto' />
            ) : tab === 'bookmarks' ? (
              <MdBookmarkBorder className='mx-auto' />
            ) : (
              <LuMessageSquare className='mx-auto' />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TabNavigation;
