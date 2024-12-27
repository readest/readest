import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';

import { BookDoc } from '@/libs/document';
import TOCView from './TOCView';
import BooknoteView from './BooknoteView';
import TabNavigation from './TabNavigation';

const SidebarContent: React.FC<{
  activeTab: string;
  bookDoc: BookDoc;
  sideBarBookKey: string;
  onTabChange: (tab: string) => void;
}> = ({ activeTab, bookDoc, sideBarBookKey, onTabChange }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  return (
    <>
      <div
        className={clsx(
          'sidebar-content flex min-h-0 flex-grow flex-col',
          'font-sans text-sm font-normal shadow-inner',
        )}
      >
        <div ref={scrollContainerRef} className='scroll-container overflow-y-auto'>
          {activeTab === 'toc' && bookDoc.toc && (
            <TOCView toc={bookDoc.toc} bookKey={sideBarBookKey} />
          )}
          {activeTab === 'annotations' && (
            <BooknoteView type='annotation' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
          )}
          {activeTab === 'bookmarks' && (
            <BooknoteView type='bookmark' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
          )}
        </div>
      </div>
      <div className='flex-shrink-0'>
        <TabNavigation activeTab={activeTab} onTabChange={onTabChange} />
      </div>
    </>
  );
};

export default SidebarContent;
