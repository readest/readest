import clsx from 'clsx';
import React, { useEffect } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSidebarStore } from '@/store/sidebarStore';
import FoliateViewer from './FoliateViewer';
import getGridTemplate from '@/utils/grid';
import SectionInfo from './SectionInfo';
import HeaderBar from './HeaderBar';
import FooterBar from './FooterBar';
import PageInfoView from './PageInfo';
import Ribbon from './Ribbon';
import SettingsDialog from './settings/SettingsDialog';
import Annotator from './annotator/Annotator';
import FootnotePopup from './FootnotePopup';
import HintInfo from './HintInfo';
import DoubleBorder from './DoubleBorder';

interface BooksGridProps {
  bookKeys: string[];
  onCloseBook: (bookKey: string) => void;
}

const BooksGrid: React.FC<BooksGridProps> = ({ bookKeys, onCloseBook }) => {
  const { appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { getProgress, getViewState, getViewSettings } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();
  const { isFontLayoutSettingsDialogOpen, setFontLayoutSettingsDialogOpen } = useSettingsStore();
  const gridTemplate = getGridTemplate(bookKeys.length, window.innerWidth / window.innerHeight);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const bookData = getBookData(sideBarBookKey);
    if (!bookData || !bookData.book) return;
    document.title = bookData.book.title;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  return (
    <div
      className={clsx(
        'grid h-full flex-grow',
        appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
      )}
      style={{
        gridTemplateColumns: gridTemplate.columns,
        gridTemplateRows: gridTemplate.rows,
      }}
    >
      {bookKeys.map((bookKey, index) => {
        const bookData = getBookData(bookKey);
        const config = getConfig(bookKey);
        const progress = getProgress(bookKey);
        const viewSettings = getViewSettings(bookKey);
        const { book, bookDoc } = bookData || {};
        if (!book || !config || !bookDoc || !viewSettings) return null;

        const { section, pageinfo, sectionLabel } = progress || {};
        const isBookmarked = getViewState(bookKey)?.ribbonVisible;
        const horizontalGapPercent = viewSettings.gapPercent;
        const verticalMarginPixels = viewSettings.marginPx;

        return (
          <div
            id={`gridcell-${bookKey}`}
            key={bookKey}
            className={`${appService?.hasRoundedWindow ? 'rounded-window' : ''} relative h-full w-full overflow-hidden`}
          >
            {isBookmarked && <Ribbon width={`${horizontalGapPercent}%`} />}
            <HeaderBar
              bookKey={bookKey}
              bookTitle={book.title}
              isTopLeft={index === 0}
              isHoveredAnim={bookKeys.length > 2}
              onCloseBook={onCloseBook}
              onSetSettingsDialogOpen={setFontLayoutSettingsDialogOpen}
            />
            <FoliateViewer bookKey={bookKey} bookDoc={bookDoc} config={config} />
            {viewSettings.vertical && viewSettings.scrolled && (
              <>
                <div
                  className='bg-base-100 absolute left-0 top-0 h-full'
                  style={{
                    width: `calc(${horizontalGapPercent}%)`,
                    height: `calc(100% - ${verticalMarginPixels}px)`,
                  }}
                />
                <div
                  className='bg-base-100 absolute right-0 top-0 h-full'
                  style={{
                    width: `calc(${horizontalGapPercent}%)`,
                    height: `calc(100% - ${verticalMarginPixels}px)`,
                  }}
                />
              </>
            )}
            {viewSettings.vertical && viewSettings.doubleBorder && (
              <DoubleBorder
                showHeader={viewSettings.showHeader}
                showFooter={viewSettings.showFooter}
                borderColor={viewSettings.borderColor}
                horizontalGap={horizontalGapPercent}
                verticalMargin={verticalMarginPixels}
              />
            )}
            {viewSettings.showHeader && (
              <SectionInfo
                section={sectionLabel}
                showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
                isScrolled={viewSettings.scrolled}
                isVertical={viewSettings.vertical}
                horizontalGap={horizontalGapPercent}
                verticalMargin={verticalMarginPixels}
              />
            )}
            <HintInfo
              bookKey={bookKey}
              showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
              isVertical={viewSettings.vertical}
              horizontalGap={horizontalGapPercent}
              verticalMargin={verticalMarginPixels}
            />
            {viewSettings.showFooter && (
              <PageInfoView
                bookFormat={book.format}
                section={section}
                pageinfo={pageinfo}
                showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
                isScrolled={viewSettings.scrolled}
                isVertical={viewSettings.vertical}
                horizontalGap={horizontalGapPercent}
                verticalMargin={verticalMarginPixels}
              />
            )}
            <Annotator bookKey={bookKey} />
            <FootnotePopup bookKey={bookKey} bookDoc={bookDoc} />
            <FooterBar
              bookKey={bookKey}
              bookFormat={book.format}
              section={section}
              pageinfo={pageinfo}
              isHoveredAnim={false}
            />
            {isFontLayoutSettingsDialogOpen && <SettingsDialog bookKey={bookKey} config={config} />}
          </div>
        );
      })}
    </div>
  );
};

export default BooksGrid;
