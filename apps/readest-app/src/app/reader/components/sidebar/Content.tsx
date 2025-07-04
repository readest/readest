import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
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
  const { appService } = useEnv();
  const { getConfig, setConfig } = useBookDataStore();
  const config = getConfig(sideBarBookKey);
  const [activeTab, setActiveTab] = useState(config?.viewSettings?.sideBarTab || 'toc');
  const [fade, setFade] = useState(false);
  const [targetTab, setTargetTab] = useState(activeTab);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey!)!;
    setActiveTab(config.viewSettings!.sideBarTab!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  const handleTabChange = (tab: string) => {
    setFade(true);
    const timeout = setTimeout(() => {
      setFade(false);
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
          'sidebar-content flex h-full min-h-0 flex-grow flex-col shadow-inner',
          'font-sans text-base font-normal sm:text-sm',
        )}
      >
        <OverlayScrollbarsComponent
          className='min-h-0 flex-1'
          options={{ scrollbars: { autoHide: 'scroll' }, showNativeOverlaidScrollbars: false }}
          defer
        >
          <div
            className={clsx('scroll-container h-full transition-opacity duration-300 ease-in-out', {
              'opacity-0': fade,
              'opacity-100': !fade,
            })}
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
      </div>
      <div
        className={clsx(
          'flex-shrink-0',
          appService?.hasSafeAreaInset && 'pb-[calc(env(safe-area-inset-bottom)/2)]',
        )}
      >
        <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </>
  );
};

export default SidebarContent;
