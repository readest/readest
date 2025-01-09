import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useBookDataStore } from '@/store/bookDataStore';
import TOCView from './TOCView';
import BooknoteView from './BooknoteView';
import TabNavigation from './TabNavigation';

const SidebarContent: React.FC<{
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { getConfig, setConfig } = useBookDataStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const showScrollbar = () => {
      container.classList.remove('hidden-scrollbar');
    };
    const hideScrollbar = () => {
      container.classList.add('hidden-scrollbar');
    };

    hideScrollbar();
    const handleScroll = () => {
      showScrollbar();
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(hideScrollbar, 2000);
    };
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey!)!;
    setActiveTab(config.viewSettings!.sideBarTab!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  const handleTabChange = (tab: string) => {
    setFade(true);
    const timeout = setTimeout(() => {
      setFade(false)
      setTargetTab(tab);
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
          'sidebar-content flex min-h-0 flex-grow flex-col',
          'font-sans text-sm font-normal shadow-inner',
        )}
      >
        <div
          ref={scrollContainerRef}
          className={clsx(
            'scroll-container overflow-y-auto transition-opacity duration-300 ease-in-out',
            { 'opacity-0': fade, 'opacity-100': !fade }
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
      </div>
      <div className='flex-shrink-0'>
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </>
  );
};

export default SidebarContent;
