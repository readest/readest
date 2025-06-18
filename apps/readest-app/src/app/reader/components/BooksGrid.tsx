import clsx from 'clsx';
import React, { useEffect } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import { getViewInsets } from '@/utils/insets';
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

  const screenInsets = useSafeAreaInsets();
  const aspectRatio = window.innerWidth / window.innerHeight;
  const gridTemplate = getGridTemplate(bookKeys.length, aspectRatio);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const bookData = getBookData(sideBarBookKey);
    if (!bookData || !bookData.book) return;
    document.title = bookData.book.title;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  if (!screenInsets) return null;

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
        const viewInsets = getViewInsets(viewSettings);
        // insets for the grid cell
        const gridInsets = {
          top: top ? screenInsets.top : 0,
          right: right ? screenInsets.right : 0,
          bottom: bottom ? screenInsets.bottom : 0,
          left: left ? screenInsets.left : 0,
        };
        // insets for the content inside the grid cell
        const contentInsets = {
          top: gridInsets.top + viewInsets.top,
          right: gridInsets.right + viewInsets.right,
          bottom: gridInsets.bottom + viewInsets.bottom,
          left: gridInsets.left + viewInsets.left,
        };
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
              insets={contentInsets}
            />
            {viewSettings.vertical && viewSettings.scrolled && (
              <>
                {(showFooter || viewSettings.doubleBorder) && (
                  <div
                    className='bg-base-100 absolute left-0 top-0 h-full'
                    style={{
                      width: `calc(${contentInsets.left + (showFooter ? 32 : 0)}px)`,
                      height: `calc(100%)`,
                    }}
                  />
                )}
                {(showHeader || viewSettings.doubleBorder) && (
                  <div
                    className='bg-base-100 absolute right-0 top-0 h-full'
                    style={{
                      width: `calc(${contentInsets.right + (showHeader ? 32 : 0)}px)`,
                      height: `calc(100%)`,
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
                contentInsets={contentInsets}
              />
            )}
            {showHeader && (
              <SectionInfo
                section={sectionLabel}
                showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
                isScrolled={viewSettings.scrolled}
                isVertical={viewSettings.vertical}
                horizontalGap={horizontalGapPercent}
                contentInsets={contentInsets}
                gridInsets={gridInsets}
              />
            )}
            <HintInfo
              bookKey={bookKey}
              showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
              isScrolled={viewSettings.scrolled}
              isVertical={viewSettings.vertical}
              horizontalGap={horizontalGapPercent}
              contentInsets={contentInsets}
              gridInsets={gridInsets}
            />
            {showFooter && (
              <ProgressInfoView
                bookKey={bookKey}
                bookFormat={book.format}
                section={section}
                pageinfo={pageinfo}
                timeinfo={timeinfo}
                horizontalGap={horizontalGapPercent}
                contentInsets={contentInsets}
                gridInsets={gridInsets}
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
