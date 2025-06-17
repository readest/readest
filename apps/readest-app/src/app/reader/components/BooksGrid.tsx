import clsx from 'clsx';
import React, { useEffect } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import FoliateViewer from './FoliateViewer';
import SectionInfo from './SectionInfo';
import HeaderBar from './HeaderBar';
import FooterBar from './FooterBar';
import ProgressInfoView from './ProgressInfo';
import Ribbon from './Ribbon';
import SettingsDialog from './settings/SettingsDialog';
import Annotator from './annotator/Annotator';
import FootnotePopup from './FootnotePopup';
import HintInfo from './HintInfo';
import DoubleBorder from './DoubleBorder';
import TTSControl from './tts/TTSControl';

interface BooksGridProps {
  bookKeys: string[];
  onCloseBook: (bookKey: string) => void;
}

const BooksGrid: React.FC<BooksGridProps> = ({ bookKeys, onCloseBook }) => {
  const { appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { getProgress, getViewState, getViewSettings, hoveredBookKey } = useReaderStore();
  const { isSideBarVisible, sideBarBookKey } = useSidebarStore();
  const { isFontLayoutSettingsDialogOpen, setFontLayoutSettingsDialogOpen } = useSettingsStore();

  const insets = useSafeAreaInsets();
  const aspectRatio = window.innerWidth / window.innerHeight;
  const gridTemplate = getGridTemplate(bookKeys.length, aspectRatio);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const bookData = getBookData(sideBarBookKey);
    if (!bookData || !bookData.book) return;
    document.title = bookData.book.title;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  if (!insets) return null;

  return (
    <div
      className={clsx('relative grid h-full flex-grow')}
      style={{
        gridTemplateColumns: gridTemplate.columns,
        gridTemplateRows: gridTemplate.rows,
      }}
    >
      {bookKeys.map((bookKey, index) => {
        const { top, right, bottom, left } = getInsetEdges(index, bookKeys.length, aspectRatio);
        const bookData = getBookData(bookKey);
        const config = getConfig(bookKey);
        const progress = getProgress(bookKey);
        const viewSettings = getViewSettings(bookKey);
        const { book, bookDoc } = bookData || {};
        if (!book || !config || !bookDoc || !viewSettings) return null;

        const { section, pageinfo, timeinfo, sectionLabel } = progress || {};
        const isBookmarked = getViewState(bookKey)?.ribbonVisible;
        const horizontalGapPercent = viewSettings.gapPercent;
        const verticalMarginPixels = viewSettings.marginPx;
        const scrolled = viewSettings.scrolled;
        const showBarsOnScroll = viewSettings.showBarsOnScroll;
        const showHeader = viewSettings.showHeader && (scrolled ? showBarsOnScroll : true);
        const showFooter = viewSettings.showFooter && (scrolled ? showBarsOnScroll : true);

        return (
          <div
            id={`gridcell-${bookKey}`}
            key={bookKey}
            className={clsx(
              'relative h-full w-full overflow-hidden',
              !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window',
            )}
          >
            {isBookmarked && !hoveredBookKey && <Ribbon width={`${horizontalGapPercent}%`} />}
            <HeaderBar
              bookKey={bookKey}
              bookTitle={book.title}
              isTopLeft={index === 0}
              isHoveredAnim={bookKeys.length > 2}
              onCloseBook={onCloseBook}
              onSetSettingsDialogOpen={setFontLayoutSettingsDialogOpen}
            />
            <FoliateViewer
              bookKey={bookKey}
              bookDoc={bookDoc}
              config={config}
              padding={{
                top: top ? insets.top : 0,
                bottom: bottom ? insets.bottom : 0,
                left: left ? insets.left : 0,
                right: right ? insets.right : 0,
              }}
            />
            {viewSettings.vertical && viewSettings.scrolled && (
              <>
                {(showFooter || viewSettings.doubleBorder) && (
                  <div
                    className='bg-base-100 absolute left-0 top-0 h-full'
                    style={{
                      width: `calc(${horizontalGapPercent}%)`,
                      height: `calc(100% - ${verticalMarginPixels}px)`,
                    }}
                  />
                )}
                {(showHeader || viewSettings.doubleBorder) && (
                  <div
                    className='bg-base-100 absolute right-0 top-0 h-full'
                    style={{
                      width: `calc(${horizontalGapPercent}%)`,
                      height: `calc(100% - ${verticalMarginPixels}px)`,
                    }}
                  />
                )}
              </>
            )}
            {viewSettings.vertical && viewSettings.doubleBorder && (
              <DoubleBorder
                showHeader={showHeader}
                showFooter={showFooter}
                borderColor={viewSettings.borderColor}
                horizontalGap={horizontalGapPercent}
                verticalMargin={verticalMarginPixels}
              />
            )}
            {showHeader && (
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
              isScrolled={viewSettings.scrolled}
              isVertical={viewSettings.vertical}
              horizontalGap={horizontalGapPercent}
              verticalMargin={verticalMarginPixels}
            />
            {showFooter && (
              <ProgressInfoView
                bookKey={bookKey}
                bookFormat={book.format}
                section={section}
                pageinfo={pageinfo}
                timeinfo={timeinfo}
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
      <TTSControl />
    </div>
  );
};

export default BooksGrid;
