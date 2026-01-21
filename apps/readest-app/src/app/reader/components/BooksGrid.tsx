import clsx from 'clsx';
import React, { useEffect } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import { getViewInsets } from '@/utils/insets';
import SearchResultsNav from './sidebar/SearchResultsNav';
import BooknotesNav from './sidebar/BooknotesNav';
import FoliateViewer from './FoliateViewer';
import SectionInfo from './SectionInfo';
import HeaderBar from './HeaderBar';
import FooterBar from './footerbar/FooterBar';
import ProgressInfoView from './ProgressInfo';
import Ribbon from './Ribbon';
import Annotator from './annotator/Annotator';
import FootnotePopup from './FootnotePopup';
import HintInfo from './HintInfo';
import DoubleBorder from './DoubleBorder';

interface BooksGridProps {
  bookKeys: string[];
  onCloseBook: (bookKey: string) => void;
}

const BooksGrid: React.FC<BooksGridProps> = ({ bookKeys, onCloseBook }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { getProgress, getViewState, getViewSettings } = useReaderStore();
  const { setGridInsets, hoveredBookKey } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();

  const { safeAreaInsets: screenInsets } = useThemeStore();
  const aspectRatio = window.innerWidth / window.innerHeight;
  const gridTemplate = getGridTemplate(bookKeys.length, aspectRatio);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const bookData = getBookData(sideBarBookKey);
    if (!bookData || !bookData.book) return;
    document.title = bookData.book.title;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey]);

  const calcGridInsets = (index: number, count: number) => {
    if (!screenInsets) return { top: 0, right: 0, bottom: 0, left: 0 };
    const { top, right, bottom, left } = getInsetEdges(index, count, aspectRatio);
    return {
      top: top ? screenInsets.top : 0,
      right: right ? screenInsets.right : 0,
      bottom: bottom ? screenInsets.bottom : 0,
      left: left ? screenInsets.left : 0,
    };
  };

  useEffect(() => {
    if (!screenInsets) return;
    bookKeys.forEach((bookKey, index) => {
      const gridInsets = calcGridInsets(index, bookKeys.length);
      setGridInsets(bookKey, gridInsets);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys, screenInsets]);

  if (!screenInsets) return null;

  return (
    <div
      className={clsx('books-grid bg-base-100 relative grid h-full flex-grow')}
      style={{
        gridTemplateColumns: gridTemplate.columns,
        gridTemplateRows: gridTemplate.rows,
      }}
      role='main'
      aria-label={_('Books Content')}
    >
      {bookKeys.map((bookKey, index) => {
        const bookData = getBookData(bookKey);
        const config = getConfig(bookKey);
        const progress = getProgress(bookKey);
        const viewSettings = getViewSettings(bookKey);
        const viewState = getViewState(bookKey);
        const gridInsets = calcGridInsets(index, bookKeys.length);
        const { book, bookDoc } = bookData || {};
        if (!book || !config || !bookDoc || !viewSettings || !viewState) return null;

        const { section, pageinfo, timeinfo, sectionLabel } = progress || {};
        const isBookmarked = viewState.ribbonVisible;
        const viewerKey = viewState.viewerKey;
        const horizontalGapPercent = viewSettings.gapPercent;
        const viewInsets = getViewInsets(viewSettings);
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
              appService?.hasRoundedWindow && 'rounded-window',
            )}
          >
            {isBookmarked && !hoveredBookKey && <Ribbon width={`${horizontalGapPercent}%`} />}
            <HeaderBar
              bookKey={bookKey}
              bookTitle={book.title}
              isTopLeft={index === 0}
              isHoveredAnim={bookKeys.length > 2}
              onCloseBook={onCloseBook}
              gridInsets={gridInsets}
            />
            <FoliateViewer
              key={viewerKey}
              bookKey={bookKey}
              bookDoc={bookDoc}
              config={config}
              gridInsets={gridInsets}
              contentInsets={contentInsets}
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
                insets={viewInsets}
              />
            )}
            {showHeader && (
              <SectionInfo
                bookKey={bookKey}
                section={sectionLabel}
                showDoubleBorder={viewSettings.vertical && viewSettings.doubleBorder}
                isScrolled={viewSettings.scrolled}
                isVertical={viewSettings.vertical}
                isEink={viewSettings.isEink}
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
              isEink={viewSettings.isEink}
              horizontalGap={horizontalGapPercent}
              contentInsets={contentInsets}
              gridInsets={gridInsets}
            />
            {showFooter && (
              <ProgressInfoView
                bookKey={bookKey}
                section={section}
                pageinfo={pageinfo}
                timeinfo={timeinfo}
                horizontalGap={horizontalGapPercent}
                contentInsets={contentInsets}
                gridInsets={gridInsets}
              />
            )}
            <Annotator bookKey={bookKey} />
            <SearchResultsNav bookKey={bookKey} gridInsets={gridInsets} />
            <BooknotesNav bookKey={bookKey} gridInsets={gridInsets} toc={bookDoc.toc || []} />
            <FootnotePopup bookKey={bookKey} bookDoc={bookDoc} />
            <FooterBar
              bookKey={bookKey}
              bookFormat={book.format}
              section={section}
              pageinfo={pageinfo}
              isHoveredAnim={false}
              gridInsets={gridInsets}
            />
          </div>
        );
      })}
    </div>
  );
};

export default BooksGrid;
