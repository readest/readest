import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import TOCView from './TOCView';
import BooknoteView from './BooknoteView';
import TabNavigation from './TabNavigation';
import ChatHistoryView from './ChatHistoryView';

const SidebarContent: React.FC<{
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey }) => {
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible, setSearchBarVisible } = useSidebarStore();
  const { getConfig, setConfig } = useBookDataStore();
  const { settings } = useSettingsStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const configuredTab = config?.viewSettings?.sideBarTab || 'toc';
  useEffect(() => {
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = null;
    setActiveTab(configuredTab);
    setTargetTab(configuredTab);
    setFade(false);
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
  }, [sideBarBookKey, configuredTab]);

  // reset to toc if history tab was active but AI is now disabled
  useEffect(() => {
    if ((activeTab === 'history' || targetTab === 'history') && !aiEnabled) {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
      setActiveTab('toc');
      setTargetTab('toc');
      setFade(false);
    }
  }, [aiEnabled, activeTab, targetTab]);

  const handleTabChange = (tab: string) => {
    if (activeTab === tab) {
      if (isMobile) {
        setHoveredBookKey(sideBarBookKey);
        setSideBarVisible(false);
      }
      return;
    }

    // The header search icon is contextual (annotation search vs in-book
    // search), so an open search bar never survives a tab switch.
    setSearchBarVisible(false);
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    setFade(true);
    setActiveTab(tab);
    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      setTargetTab(tab);
      setFade(false);
      const latestConfig = getConfig(sideBarBookKey);
      if (latestConfig) {
        setConfig(sideBarBookKey, {
          viewSettings: { ...latestConfig.viewSettings, sideBarTab: tab },
        });
      }
    }, 300);
  };

  return (
    <>
      <div
        className={clsx(
          'sidebar-content flex h-full min-h-0 grow flex-col shadow-inner',
          'font-sans text-base font-normal sm:text-sm',
        )}
      >
        {targetTab === 'history' ? (
          <ChatHistoryView bookKey={sideBarBookKey} />
        ) : (
          <OverlayScrollbarsComponent
            className='min-h-0 flex-1'
            options={{
              // The tab content is width-bound; x stays hidden so oversized
              // touch-target halos (e.g. the toolbar's dropdown toggle) can't
              // turn into a horizontal scrollbar.
              overflow: { x: 'hidden' },
              scrollbars: { autoHide: 'scroll', clickScroll: true },
              showNativeOverlaidScrollbars: false,
            }}
            defer
          >
            <div
              className={clsx(
                'scroll-container h-full transition-opacity duration-300 ease-in-out',
                {
                  'opacity-0': fade,
                  'opacity-100': !fade,
                },
              )}
            >
              {targetTab === 'toc' && bookDoc.toc && (
                <TOCView toc={bookDoc.toc} bookKey={sideBarBookKey} />
              )}
              {targetTab === 'annotations' && (
                <BooknoteView type='annotation' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
              )}
              {targetTab === 'bookmarks' && (
                <BooknoteView type='bookmark' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
              )}
            </div>
          </OverlayScrollbarsComponent>
        )}
      </div>
      <div
        className='shrink-0'
        style={
          {
            // paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) / 2)',
          }
        }
      >
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </>
  );
};

export default SidebarContent;
