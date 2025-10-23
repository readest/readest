import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import TOCView from './TOCView';
import BooknoteView from './BooknoteView';
import TabNavigation from './TabNavigation';

const SidebarContent: React.FC<{
  bookDoc: BookDoc;
  sideBarBookKey: string;
}> = ({ bookDoc, sideBarBookKey }) => {
  const { safeAreaInsets } = useThemeStore();
  const { setHoveredBookKey } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const { getConfig, setConfig } = useBookDataStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  useEffect(() => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey!)!;
    setActiveTab(config.viewSettings!.sideBarTab!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  const handleTabChange = (tab: string) => {
    setFade(true);
    const timeout = setTimeout(() => {
      if (activeTab === tab && isMobile) {
        setHoveredBookKey(sideBarBookKey);
        setSideBarVisible(false);
        return;
      }
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
          'font-sans text-base font-normal sm:text-sm',
        )}
      >
        <OverlayScrollbarsComponent
          className='min-h-0 flex-1'
          options={{
            scrollbars: { autoHide: 'scroll', clickScroll: true },
            showNativeOverlaidScrollbars: false,
          }}
          defer
        >
          <div
            className={clsx('scroll-container h-full transition-opacity duration-300 ease-in-out', {
              'opacity-0': fade,
              'opacity-100': !fade,
            })}
          >
            {targetTab === 'toc' && bookDoc.toc && (
              <TOCView toc={bookDoc.toc} sections={bookDoc.sections} bookKey={sideBarBookKey} />
            )}
            {targetTab === 'annotations' && (
              <BooknoteView type='annotation' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
            )}
            {targetTab === 'bookmarks' && (
              <BooknoteView type='bookmark' toc={bookDoc.toc ?? []} bookKey={sideBarBookKey} />
            )}
          </div>
        </OverlayScrollbarsComponent>
      </div>
      <div
        className='flex-shrink-0'
        style={{
          paddingBottom: `${(safeAreaInsets?.bottom || 0) / 2}px`,
        }}
      >
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </>
  );
};

export default SidebarContent;
