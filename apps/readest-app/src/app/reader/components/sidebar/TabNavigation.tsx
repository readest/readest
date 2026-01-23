import clsx from 'clsx';
import React from 'react';
import { MdBookmarkBorder } from 'react-icons/md';
import { IoIosList } from 'react-icons/io';
import { PiNotePencil } from 'react-icons/pi';
import { LuMessageSquare } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const TabNavigation: React.FC<{
  activeTab: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, onTabChange }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

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

  return (
    <TooltipProvider>
      <div
        className={clsx(
          'bottom-tab border-base-300/50 bg-base-200/20 flex w-full border-t',
          appService?.hasRoundedWindow && 'rounded-window-bottom-left',
        )}
        dir='ltr'
      >
        {tabs.map((tab) => (
          <Tooltip key={tab}>
            <TooltipTrigger asChild>
              <div
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
                aria-label={getTabLabel(tab)}
              >
                <div className='m-0 flex h-6 items-center p-0'>
                  {tab === 'toc' ? (
                    <IoIosList className='mx-auto' size={20} />
                  ) : tab === 'annotations' ? (
                    <PiNotePencil className='mx-auto' size={20} />
                  ) : tab === 'bookmarks' ? (
                    <MdBookmarkBorder className='mx-auto' size={20} />
                  ) : (
                    <LuMessageSquare className='mx-auto' size={20} />
                  )}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side='top'>{getTabLabel(tab)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
};

export default TabNavigation;
