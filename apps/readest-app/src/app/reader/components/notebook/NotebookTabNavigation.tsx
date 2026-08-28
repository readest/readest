import clsx from 'clsx';
import React, { useEffect } from 'react';
import { PiNotePencil, PiRobot } from 'react-icons/pi';
import { LuScanSearch } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { NotebookTab } from '@/store/notebookStore';

interface NotebookTabNavigationProps {
  activeTab: NotebookTab;
  onTabChange: (tab: NotebookTab) => void;
}

const NotebookTabNavigation: React.FC<NotebookTabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const xrayEnabled =
    aiEnabled && !!settings?.aiSettings?.reedy?.enabled && appService?.appPlatform === 'tauri';

  useEffect(() => {
    if (activeTab === 'xray' && !xrayEnabled) onTabChange(aiEnabled ? 'ai' : 'notes');
  }, [activeTab, aiEnabled, onTabChange, xrayEnabled]);

  const tabs: NotebookTab[] = aiEnabled
    ? xrayEnabled
      ? ['notes', 'ai', 'xray']
      : ['notes', 'ai']
    : [];

  const getTabLabel = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return _('Notes');
      case 'ai':
        return _('AI');
      case 'xray':
        return _('X-Ray');
      default:
        return '';
    }
  };

  const getTabIcon = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return <PiNotePencil className='mx-auto' size={20} />;
      case 'ai':
        return <PiRobot className='mx-auto' size={20} />;
      case 'xray':
        return <LuScanSearch className='mx-auto' size={18} />;
      default:
        return null;
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    onTabChange(tabs[nextIndex]!);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('button')
      .item(nextIndex)
      .focus();
  };

  return (
    <nav
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex min-h-[52px] w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-right',
      )}
      dir='ltr'
      aria-label={_('Notebook sections')}
    >
      {tabs.map((tab, index) => (
        <button
          type='button'
          key={tab}
          aria-pressed={activeTab === tab}
          className={clsx(
            'm-1.5 flex-1 cursor-pointer rounded-lg p-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
            activeTab === tab && 'bg-base-300/85',
          )}
          onClick={() => onTabChange(tab)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
        >
          <div className='m-0 flex h-6 items-center p-0'>{getTabIcon(tab)}</div>
        </button>
      ))}
    </nav>
  );
};

export default NotebookTabNavigation;
