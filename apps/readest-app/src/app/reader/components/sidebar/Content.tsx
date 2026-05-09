import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { LuX } from 'react-icons/lu';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
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
  const _ = useTranslation();
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;
  const aiEnabled = settings?.aiSettings?.enabled ?? false;

  const getPanelTitle = (tab: string) => {
    switch (tab) {
      case 'reading':
        return 'Reading';
      case 'toc':
        return 'Contents';
      case 'annotations':
        return 'Notes';
      case 'bookmarks':
        return 'Bookmarks';
      case 'history':
        return 'Highlights';
      default:
        return 'Contents';
    }
  };

  useEffect(() => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey!)!;
    setActiveTab(config.viewSettings!.sideBarTab!);
    setTargetTab(config.viewSettings!.sideBarTab!);
    setIsPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  // reset to toc if history tab was active but AI is now disabled
  useEffect(() => {
    if ((activeTab === 'history' || targetTab === 'history') && !aiEnabled) {
      setActiveTab('toc');
      setTargetTab('toc');
      setIsPanelOpen(true);
    }
  }, [aiEnabled, activeTab, targetTab]);

  const handleTabChange = (tab: string) => {
    setIsPanelOpen(true);
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
        data-panel-open={isPanelOpen ? 'true' : 'false'}
        className={clsx(
          'sidebar-content flex h-full min-h-0 flex-grow flex-col shadow-inner',
          'font-sans text-base font-normal text-[#d8c39b] sm:text-sm sm:text-[#d9c39a]',
          'bg-[linear-gradient(180deg,rgba(20,13,11,0.96),rgba(11,8,7,0.98))]',
        )}
      >
        <div className='citadel-open-panel-shell flex h-full min-h-0 flex-col'>
          <div className='citadel-open-panel-header flex items-center justify-between gap-4 px-7 pb-3 pt-[26px]'>
            <div className='min-w-0'>
              <h2 className='citadel-open-panel-title text-[1.24rem] font-semibold uppercase tracking-[0.24em] text-[#efdfa9]'>
                {_(getPanelTitle(targetTab))}
              </h2>
            </div>
            <button
              type='button'
              title={_('Close')}
              aria-label={_('Close')}
              onClick={() => setIsPanelOpen(false)}
              className='citadel-open-panel-close flex h-8 w-8 items-center justify-center rounded-full'
            >
              <LuX size={16} />
            </button>
          </div>
          <div className='citadel-open-panel-rule mx-7' />
          <div className='citadel-open-panel-body min-h-0 flex-1 px-4 pb-4 pt-0'>
            {targetTab === 'history' ? (
              <div className='citadel-open-panel-scroll flex min-h-0 flex-1 flex-col pt-3'>
                <ChatHistoryView bookKey={sideBarBookKey} />
              </div>
            ) : targetTab === 'reading' ? (
              (() => {
                const book = getBookData(sideBarBookKey)?.book;
                return (
                  <div className='citadel-open-panel-scroll h-full overflow-y-auto px-1 pb-4 pt-3'>
                    {book ? (
                      <BookCard book={book} />
                    ) : (
                      <div className='citadel-panel-empty flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center'>
                        <p className='text-[13px] text-[#968671]'>No book data available.</p>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <OverlayScrollbarsComponent
                className='citadel-open-panel-scroll min-h-0 flex-1 pt-3'
                options={{
                  scrollbars: { autoHide: 'scroll', clickScroll: true },
                  showNativeOverlaidScrollbars: false,
                }}
                defer
              >
                <div
                  className={clsx(
                    'scroll-container h-full px-1 pb-5 pt-0 transition-opacity duration-300 ease-in-out',
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
                    <BooknoteView
                      type='annotation'
                      toc={bookDoc.toc ?? []}
                      bookKey={sideBarBookKey}
                    />
                  )}
                  {targetTab === 'bookmarks' && (
                    <BooknoteView
                      type='bookmark'
                      toc={bookDoc.toc ?? []}
                      bookKey={sideBarBookKey}
                    />
                  )}
                </div>
              </OverlayScrollbarsComponent>
            )}
          </div>
        </div>
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
            background:
              radial-gradient(circle at 14% 12%, rgba(110, 24, 17, 0.04), transparent 20%),
              radial-gradient(circle at 86% 100%, rgba(86, 24, 16, 0.03), transparent 16%),
              linear-gradient(180deg, rgb(20, 13, 10), rgb(8, 6, 5));
          }

          .sidebar-content[data-panel-open='false'] {
            opacity: 0 !important;
            pointer-events: none !important;
            transform: translateX(-12px) !important;
          }

          .sidebar-content::after {
            content: '';
            position: absolute;
            inset: 10px;
            border-radius: 22px;
            border: 1px solid rgba(171, 132, 68, 0.18);
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.035),
              inset 0 0 0 1px rgba(72, 52, 27, 0.18),
              inset 0 -1px 0 rgba(0, 0, 0, 0.32);
            pointer-events: none;
          }

          .citadel-open-panel-shell {
            position: relative;
            z-index: 1;
            display: flex;
            min-height: 0;
            height: 100%;
            flex-direction: column;
          }

          .citadel-open-panel-header,
          .citadel-open-panel-rule {
            flex: 0 0 auto;
          }

          .citadel-open-panel-title {
            font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
            color: rgba(238, 214, 154, 0.96);
            letter-spacing: 0.24em;
            text-shadow: 0 1px 0 rgba(0, 0, 0, 0.42);
          }

          .citadel-open-panel-close {
            color: rgba(203, 167, 103, 0.84);
            border: 1px solid rgba(120, 92, 49, 0.22);
            background: rgba(22, 15, 13, 0.36);
            align-self: center;
            transition:
              color 150ms ease,
              background-color 150ms ease,
              border-color 150ms ease;
          }

          .citadel-open-panel-close:hover {
            color: rgba(240, 215, 160, 0.96);
            border-color: rgba(171, 132, 68, 0.28);
            background: rgba(44, 24, 20, 0.46);
          }

          .citadel-open-panel-close:focus-visible {
            outline: none;
            box-shadow:
              0 0 0 1px rgba(201, 164, 90, 0.88),
              0 0 0 3px rgba(120, 24, 18, 0.28);
          }

          .citadel-open-panel-rule {
            height: 1px;
            background: linear-gradient(
              90deg,
              rgba(178, 135, 70, 0.1),
              rgba(210, 166, 88, 0.24) 14%,
              rgba(178, 135, 70, 0.14) 100%
            );
          }

          .citadel-open-panel-body {
            min-height: 0;
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            overflow: hidden;
          }

          .citadel-open-panel-scroll {
            min-height: 0;
            flex: 1 1 auto;
          }

          .citadel-open-panel-body .os-scrollbar-handle {
            background: rgba(176, 136, 72, 0.34);
          }

          .citadel-open-panel-body .os-scrollbar-track {
            background: rgba(13, 10, 9, 0.32);
          }

          .citadel-open-panel-body .scroll-container,
          .citadel-open-panel-body .toc-list,
          .citadel-open-panel-body > div {
            min-height: 0;
          }

          .citadel-open-panel-body .os-host,
          .citadel-open-panel-body .os-padding,
          .citadel-open-panel-body .os-viewport,
          .citadel-open-panel-body .os-content {
            min-height: 0;
          }

          .citadel-panel-empty {
            color: rgba(208, 187, 146, 0.82);
          }
        }
      `}</style>
    </>
  );
};

export default SidebarContent;
