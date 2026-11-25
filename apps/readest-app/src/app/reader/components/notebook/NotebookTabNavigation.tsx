import clsx from 'clsx';
import React from 'react';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { NotebookTab } from '@/store/notebookStore';
import { getNotebookTabs } from './notebookTabs';

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

  // The Dictionary tab keeps the latest lookup beside the notes (#7730). The
  // X-Ray tab is there once the X-Ray is on or was pinned.
  const xrayEnabled = useCustomDictionaryStore(
    (s) => s.settings.providerEnabled[BUILTIN_PROVIDER_IDS.xray],
  );
  const tabs: NotebookTab[] = ['notes'];
  if (aiEnabled) tabs.push('ai');
  tabs.push('dictionary');
  if (xrayEnabled || activeTab === 'xray') tabs.push('xray');
  const tabInfo = getNotebookTabs(_);
  const getTabLabel = (tab: NotebookTab) => tabInfo[tab].label;
  const getTabIcon = (tab: NotebookTab) => {
    const Icon = tabInfo[tab].icon;
    return <Icon className='mx-auto' size={20} />;
  };

  // Lines up with the footer bar's top rule on e-ink, as the sidebar's does.
  return (
    <div
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex min-h-[52px] w-full border-t',
        'eink:border-base-content eink:bg-base-100 eink:h-[52px]',
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
            'eink:flex eink:items-center eink:justify-center eink:py-0',
            activeTab === tab && 'bg-base-300/85 eink-bordered',
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
          <div className='m-0 flex h-6 items-center p-0'>{getTabIcon(tab)}</div>
        </div>
      ))}
    </div>
  );
};

export default NotebookTabNavigation;
