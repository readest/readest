import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

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
import BookCard from './BookCard';

const SidebarContent: React.FC<{
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey }) => {
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  useEffect(() => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey!)!;
    setActiveTab(config.viewSettings!.sideBarTab!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  // reset to toc if history tab was active but AI is now disabled
  useEffect(() => {
    if ((activeTab === 'history' || targetTab === 'history') && !aiEnabled) {
      setActiveTab('toc');
      setTargetTab('toc');
    }
  }, [aiEnabled, activeTab, targetTab]);

  const handleTabChange = (tab: string) => {
    if (tab === 'reading') {
      setActiveTab('reading');
      setTargetTab('reading');
      if (isMobile) {
        setHoveredBookKey(sideBarBookKey);
        setSideBarVisible(false);
      }
      return;
    }

    if (activeTab === tab) {
      if (isMobile) {
        setHoveredBookKey(sideBarBookKey);
        setSideBarVisible(false);
      }
      return;
    }

    setFade(true);
    const timeout = setTimeout(() => {
      setTargetTab(tab);
      setFade(false);
      setConfig(sideBarBookKey!, config);
      clearTimeout(timeout);
    }, 300);

    setActiveTab(tab);
    const config = getConfig(sideBarBookKey!)!;
    config.viewSettings!.sideBarTab = tab;
  };

  return (
    <>
      <div
        className={clsx(
          'sidebar-content flex h-full min-h-0 flex-grow flex-col shadow-inner',
          'font-sans text-base font-normal text-[#d8c39b] sm:text-sm sm:text-[#d9c39a]',
          'bg-[linear-gradient(180deg,rgba(20,13,11,0.96),rgba(11,8,7,0.98))]',
        )}
      >
        {targetTab === 'history' ? (
          <ChatHistoryView bookKey={sideBarBookKey} />
        ) : targetTab === 'reading' ? (
          (() => {
            const book = getBookData(sideBarBookKey)?.book;
            return (
              <div className='h-full overflow-y-auto px-3 py-3'>
                {book ? (
                  <BookCard book={book} />
                ) : (
                  <p className='text-[13px] text-[#968671]'>No book data available.</p>
                )}
              </div>
            );
          })()
        ) : (
          <OverlayScrollbarsComponent
            className='min-h-0 flex-1'
            options={{
              scrollbars: { autoHide: 'scroll', clickScroll: true },
              showNativeOverlaidScrollbars: false,
            }}
            defer
          >
            <div
              className={clsx(
                'scroll-container h-full px-3 pb-4 pt-3 transition-opacity duration-300 ease-in-out',
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
        className='border-[#6a4d28]/22 flex-shrink-0 border-t bg-[linear-gradient(180deg,rgba(16,11,10,0.94),rgba(10,7,6,0.98))]'
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) / 2)',
        }}
      >
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
      <style jsx global>{`
        @media (min-width: 640px) {
          .sidebar-content {
            overflow: hidden;
          }

          .sidebar-content::after {
            content: '';
            position: absolute;
            inset: 14px;
            border-radius: 18px;
            border: 1px solid rgba(103, 73, 34, 0.22);
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.04),
              inset 0 -1px 0 rgba(0, 0, 0, 0.28);
            pointer-events: none;
          }
        }
      `}</style>
    </>
  );
};

export default SidebarContent;
