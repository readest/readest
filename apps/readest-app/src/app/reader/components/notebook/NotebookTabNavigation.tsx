import clsx from 'clsx';
import React from 'react';
import { PiNotePencil, PiRobot } from 'react-icons/pi';
import { RiPencilLine } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { NotebookTab } from '@/store/notebookStore';

interface NotebookTabNavigationProps {
  bookKey: string;
  activeTab: NotebookTab;
  onTabChange: (tab: NotebookTab) => void;
}

const NotebookTabNavigation: React.FC<NotebookTabNavigationProps> = ({
  bookKey,
  activeTab,
  onTabChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig } = useBookDataStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;
  const hasInk = Object.keys(getConfig(bookKey)?.handwriting?.pages ?? {}).length > 0;

  // AI and ink are additive tabs: AI needs its setting on, and the ink tab only
  // earns its place once the book actually has handwriting — an always-empty
  // third tab is just noise. With neither, the bar renders nothing at all,
  // which is the original design (a lone tab would be a pointless footer).
  const tabs: NotebookTab[] = [];
  if (aiEnabled) tabs.push('ai');
  if (hasInk) tabs.push('handwriting');
  if (aiEnabled || hasInk) tabs.unshift('notes');

  if (tabs.length === 0) return null;

  const getTabLabel = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return _('Notes');
      case 'handwriting':
        return _('Handwriting');
      case 'ai':
        return _('AI');
      default:
        return '';
    }
  };

  const getTabIcon = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return <PiNotePencil className='mx-auto' size={20} />;
      case 'handwriting':
        return <RiPencilLine className='mx-auto' size={20} />;
      case 'ai':
        return <PiRobot className='mx-auto' size={20} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex min-h-[52px] w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-right',
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
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
        >
          <div className='m-0 flex h-6 items-center p-0'>{getTabIcon(tab)}</div>
        </div>
      ))}
    </div>
  );
};

export default NotebookTabNavigation;
