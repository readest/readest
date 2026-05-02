import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

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
import PageNavigationButtons from './PageNavigationButtons';
import FooterBar from './footerbar/FooterBar';
import ProgressBar from './ProgressBar';
import Ribbon from './Ribbon';
import Annotator from './annotator/Annotator';
import FootnotePopup from './FootnotePopup';
import HintInfo from './HintInfo';
import ReadingRuler from './ReadingRuler';
import DoubleBorder from './DoubleBorder';

interface BooksGridProps {
  bookKeys: string[];
  onGoToLibrary: () => void;
}

const BooksGrid: React.FC<BooksGridProps> = ({ bookKeys, onGoToLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { getProgress, getViewState, getViewSettings } = useReaderStore();
  const { setGridInsets, hoveredBookKey } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();
  const [dropdownOpenBook, setDropdownOpenBook] = useState<string>('');

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
      className={clsx('books-grid relative grid h-full flex-grow overflow-hidden bg-[#080606]')}
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

        const { section, pageinfo, sectionLabel } = progress || {};
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
        const isCompactViewport = window.innerWidth < 640;
        const shellInsetTop = isCompactViewport ? 8 : 10;
        const shellInsetSide = isCompactViewport ? 6 : 10;
        const shellInsetBottom = isCompactViewport ? 8 : 10;
        const frameInsetTop = isCompactViewport ? 16 : 22;
        const frameInsetSide = isCompactViewport ? 12 : 26;
        const frameInsetBottom = isCompactViewport ? 34 : 42;
        const wellInsetTop = isCompactViewport ? 32 : 36;
        const wellInsetSide = isCompactViewport ? 20 : 38;
        const wellInsetBottom = isCompactViewport ? 62 : 72;
        const spineWidth = isCompactViewport ? 26 : 42;
        const cornerSize = isCompactViewport ? 22 : 28;
        const shellStyle: React.CSSProperties = {
          top: `${shellInsetTop}px`,
          right: `${shellInsetSide}px`,
          bottom: `${shellInsetBottom}px`,
          left: `${shellInsetSide}px`,
        };
        const frameStyle: React.CSSProperties = {
          top: `${frameInsetTop}px`,
          right: `${frameInsetSide}px`,
          bottom: `${frameInsetBottom}px`,
          left: `${frameInsetSide}px`,
        };
        const wellStyle: React.CSSProperties = {
          top: `${wellInsetTop}px`,
          right: `${wellInsetSide}px`,
          bottom: `${wellInsetBottom}px`,
          left: `${wellInsetSide}px`,
        };
        const headerSeatStyle: React.CSSProperties = {
          top: `${isCompactViewport ? 14 : 18}px`,
          right: `${isCompactViewport ? 12 : 22}px`,
          left: `${isCompactViewport ? 12 : 22}px`,
          height: `${isCompactViewport ? 36 : 40}px`,
        };
        const footerSeatStyle: React.CSSProperties = {
          right: `${isCompactViewport ? 12 : 22}px`,
          bottom: `${isCompactViewport ? 10 : 12}px`,
          left: `${isCompactViewport ? 12 : 22}px`,
          height: `${isCompactViewport ? 50 : 58}px`,
        };
        const spineStyle: React.CSSProperties = {
          top: `${wellInsetTop + 2}px`,
          bottom: `${wellInsetBottom + 2}px`,
          left: '50%',
          width: `${spineWidth}px`,
          transform: 'translateX(-50%)',
        };
        const cornerConfigs = [
          {
            className: 'reader-frame-corner-tl',
            style: {
              top: `${wellInsetTop}px`,
              left: `${wellInsetSide}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
            },
          },
          {
            className: 'reader-frame-corner-tr',
            style: {
              top: `${wellInsetTop}px`,
              right: `${wellInsetSide}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
            },
          },
          {
            className: 'reader-frame-corner-bl',
            style: {
              bottom: `${wellInsetBottom}px`,
              left: `${wellInsetSide}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
            },
          },
          {
            className: 'reader-frame-corner-br',
            style: {
              right: `${wellInsetSide}px`,
              bottom: `${wellInsetBottom}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
            },
          },
        ];

        return (
          <div
            id={`gridcell-${bookKey}`}
            key={bookKey}
            className={clsx(
              'relative h-full w-full overflow-hidden bg-[#0b0705]',
              appService?.hasRoundedWindow && 'rounded-window',
            )}
          >
            <div className='reader-frame-aura pointer-events-none absolute inset-0 z-0' />
            <div
              className='reader-frame-shell pointer-events-none absolute z-0'
              style={shellStyle}
            />
            <div
              className='reader-frame-ornament pointer-events-none absolute z-0'
              style={frameStyle}
            />
            <div
              className='reader-frame-header-seat pointer-events-none absolute z-0'
              style={headerSeatStyle}
            />
            <div
              className='reader-frame-footer-seat pointer-events-none absolute z-0'
              style={footerSeatStyle}
            />
            {cornerConfigs.map(({ className, style }) => (
              <div
                key={className}
                className={clsx(
                  'reader-frame-corner pointer-events-none absolute z-[1]',
                  className,
                )}
                style={style}
              />
            ))}
            {isBookmarked && !hoveredBookKey && <Ribbon width={`${horizontalGapPercent}%`} />}
            <HeaderBar
              bookKey={bookKey}
              gridInsets={gridInsets}
              screenInsets={screenInsets}
              bookTitle={book.title}
              isTopLeft={index === 0}
              isHoveredAnim={bookKeys.length > 2}
              onGoToLibrary={onGoToLibrary}
              onDropdownOpenChange={(isOpen) => setDropdownOpenBook(isOpen ? bookKey : '')}
            />
            <FoliateViewer
              key={viewerKey}
              bookKey={bookKey}
              bookDoc={bookDoc}
              config={config}
              gridInsets={gridInsets}
              contentInsets={contentInsets}
            />
            <div
              className='reader-frame-well pointer-events-none absolute z-[1]'
              style={wellStyle}
            />
            <div
              className='reader-frame-spine pointer-events-none absolute z-[2]'
              style={spineStyle}
            />
            {viewSettings.vertical && viewSettings.scrolled && (
              <>
                {(showFooter || viewSettings.doubleBorder) && (
                  <div
                    className='absolute left-0 top-0 h-full bg-[linear-gradient(180deg,rgba(17,12,10,0.98),rgba(9,7,6,0.98))]'
                    style={{
                      width: `calc(${contentInsets.left + (viewSettings.doubleBorder ? 32 : 0)}px)`,
                      height: `calc(100%)`,
                    }}
                  />
                )}
                {(showHeader || viewSettings.doubleBorder) && (
                  <div
                    className='absolute right-0 top-0 h-full bg-[linear-gradient(180deg,rgba(17,12,10,0.98),rgba(9,7,6,0.98))]'
                    style={{
                      width: `calc(${contentInsets.right + (viewSettings.doubleBorder ? 32 : 0)}px)`,
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
            {viewSettings.readingRulerEnabled && viewState?.inited && (
              <ReadingRuler
                bookKey={bookKey}
                isVertical={viewSettings.vertical}
                rtl={viewSettings.rtl}
                lines={viewSettings.readingRulerLines}
                position={viewSettings.readingRulerPosition}
                opacity={viewSettings.readingRulerOpacity}
                color={viewSettings.readingRulerColor}
                bookFormat={book.format}
                viewSettings={viewSettings}
                gridInsets={gridInsets}
              />
            )}
            {showFooter && (
              <ProgressBar
                bookKey={bookKey}
                horizontalGap={horizontalGapPercent}
                contentInsets={contentInsets}
                gridInsets={gridInsets}
              />
            )}
            <PageNavigationButtons
              bookKey={bookKey}
              isDropdownOpen={dropdownOpenBook === bookKey}
            />
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
      <style jsx global>{`
        /* ── Aura: warm burgundy glow from all sides ── */
        .books-grid .reader-frame-aura {
          background:
            radial-gradient(ellipse 26% 62% at 0% 50%, rgba(138, 28, 20, 0.36), transparent),
            radial-gradient(ellipse 26% 62% at 100% 50%, rgba(138, 28, 20, 0.36), transparent),
            radial-gradient(ellipse 68% 26% at 50% 0%, rgba(106, 34, 24, 0.22), transparent),
            radial-gradient(ellipse 52% 18% at 50% 100%, rgba(74, 16, 12, 0.18), transparent);
        }

        /* ── Shell: ornate dark book frame with ONE clear gold rim ── */
        .books-grid .reader-frame-shell {
          border-radius: 22px;
          background: linear-gradient(
            170deg,
            rgba(58, 31, 23, 0.98) 0%,
            rgba(28, 17, 13, 1) 24%,
            rgba(12, 8, 7, 1) 62%,
            rgba(8, 5, 4, 1) 100%
          );
          box-shadow:
            0 42px 90px rgba(0, 0, 0, 0.58),
            0 0 56px rgba(138, 30, 22, 0.22),
            inset 0 0 0 1.6px rgba(196, 158, 84, 0.84),
            inset 0 0 0 6px rgba(11, 8, 7, 0.94),
            inset 0 22px 40px rgba(255, 228, 190, 0.016),
            inset 0 -46px 64px rgba(0, 0, 0, 0.54);
        }

        .books-grid .reader-frame-shell::before {
          content: '';
          position: absolute;
          inset: 10px;
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(255, 229, 186, 0.02), rgba(0, 0, 0, 0));
          box-shadow:
            inset 0 22px 38px rgba(255, 224, 185, 0.012),
            inset 0 -38px 54px rgba(0, 0, 0, 0.36);
        }

        .books-grid .reader-frame-shell::after {
          display: none;
        }

        /* ── Ornament: depth only, no extra gold rings ── */
        .books-grid .reader-frame-ornament {
          border-radius: 18px;
          background: none;
          box-shadow:
            inset 0 24px 40px rgba(0, 0, 0, 0.15),
            inset 0 -36px 50px rgba(0, 0, 0, 0.28);
        }

        /* ── Seat: frame tray — no border, just tonal fill + depth shadow ── */
        .books-grid .reader-frame-header-seat {
          border-radius: 12px 12px 0 0;
          background: linear-gradient(180deg, rgba(16, 10, 8, 0.98), rgba(10, 6, 5, 0.99));
          box-shadow:
            inset 0 -1px 0 rgba(52, 32, 14, 0.22),
            inset 0 -18px 28px rgba(0, 0, 0, 0.38);
        }

        .books-grid .reader-frame-footer-seat {
          border-radius: 0 0 12px 12px;
          background: linear-gradient(180deg, rgba(12, 8, 6, 0.98), rgba(7, 4, 3, 0.99));
          box-shadow:
            inset 0 1px 0 rgba(52, 32, 14, 0.18),
            inset 0 18px 28px rgba(0, 0, 0, 0.32);
        }

        /* ── Pages: dark two-page book surface, warm and recessed ── */
        .books-grid .reader-frame-well {
          border-radius: 14px;
          background:
            radial-gradient(ellipse 52% 78% at 50% 46%, rgba(120, 76, 42, 0.14), transparent 52%),
            radial-gradient(ellipse 36% 86% at 2% 48%, rgba(0, 0, 0, 0.36), transparent 70%),
            radial-gradient(ellipse 36% 86% at 98% 48%, rgba(0, 0, 0, 0.36), transparent 70%),
            linear-gradient(
              90deg,
              rgba(6, 4, 4, 0.44) 0%,
              rgba(10, 7, 6, 0.22) 8%,
              rgba(34, 24, 19, 0.1) 18%,
              transparent 31%,
              rgba(0, 0, 0, 0.08) 42%,
              rgba(0, 0, 0, 0.22) 46.5%,
              rgba(0, 0, 0, 0.36) 48.8%,
              rgba(0, 0, 0, 0.46) 50%,
              rgba(0, 0, 0, 0.36) 51.2%,
              rgba(0, 0, 0, 0.22) 53.5%,
              rgba(0, 0, 0, 0.08) 58%,
              transparent 69%,
              rgba(34, 24, 19, 0.1) 82%,
              rgba(10, 7, 6, 0.22) 92%,
              rgba(6, 4, 4, 0.44) 100%
            ),
            linear-gradient(
              180deg,
              rgba(34, 22, 18, 0.16) 0%,
              rgba(0, 0, 0, 0.18) 10%,
              transparent 26%,
              transparent 72%,
              rgba(0, 0, 0, 0.14) 90%,
              rgba(0, 0, 0, 0.38) 100%
            );
          box-shadow:
            inset 0 0 0 1px rgba(122, 90, 42, 0.05),
            inset 0 0 0 3px rgba(0, 0, 0, 0.22),
            inset 0 18px 30px rgba(255, 230, 186, 0.02),
            inset 0 -34px 46px rgba(0, 0, 0, 0.28),
            inset 26px 0 42px rgba(0, 0, 0, 0.18),
            inset -26px 0 42px rgba(0, 0, 0, 0.18);
        }

        .books-grid .reader-frame-well::before,
        .books-grid .reader-frame-well::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          width: calc(50% - 27px);
          pointer-events: none;
          border-radius: 12px;
          background:
            radial-gradient(ellipse 72% 74% at 50% 42%, rgba(214, 156, 88, 0.022), transparent 66%),
            linear-gradient(
              180deg,
              rgba(255, 220, 160, 0.01),
              transparent 16%,
              transparent 82%,
              rgba(0, 0, 0, 0.08)
            ),
            repeating-linear-gradient(
              0deg,
              rgba(255, 230, 170, 0.004) 0px,
              rgba(255, 230, 170, 0.004) 1px,
              transparent 1px,
              transparent 10px
            );
          opacity: 0.76;
        }

        .books-grid .reader-frame-well::before {
          left: 0;
          width: calc(50% - 22px);
          box-shadow:
            inset -38px 0 48px rgba(0, 0, 0, 0.22),
            inset 14px 0 22px rgba(214, 168, 94, 0.042);
        }

        .books-grid .reader-frame-well::after {
          right: 0;
          width: calc(50% - 22px);
          box-shadow:
            inset 38px 0 48px rgba(0, 0, 0, 0.22),
            inset -14px 0 22px rgba(214, 168, 94, 0.04);
        }

        /* ── Spine: soft book gutter crease, no bright gold stripe ── */
        .books-grid .reader-frame-spine {
          border-radius: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(0, 0, 0, 0.06) 18%,
            rgba(0, 0, 0, 0.26) 38%,
            rgba(0, 0, 0, 0.46) 48%,
            rgba(0, 0, 0, 0.54) 50%,
            rgba(0, 0, 0, 0.46) 52%,
            rgba(0, 0, 0, 0.26) 62%,
            rgba(0, 0, 0, 0.06) 82%,
            transparent 100%
          );
          box-shadow:
            -12px 0 26px rgba(0, 0, 0, 0.1),
            12px 0 26px rgba(0, 0, 0, 0.1),
            inset 8px 0 14px rgba(0, 0, 0, 0.08),
            inset -8px 0 14px rgba(0, 0, 0, 0.08);
        }

        .books-grid .reader-frame-spine::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 16px;
          transform: translateX(-50%);
          background: linear-gradient(
            90deg,
            rgba(100, 72, 34, 0.02) 0%,
            transparent 30%,
            rgba(0, 0, 0, 0.16) 50%,
            transparent 70%,
            rgba(100, 72, 34, 0.02) 100%
          );
        }

        /* ── Corners: antique gold filet with jewel dot at vertex ── */
        .books-grid .reader-frame-corner::before,
        .books-grid .reader-frame-corner::after {
          content: '';
          position: absolute;
          pointer-events: none;
        }

        .books-grid .reader-frame-corner-tl::before {
          inset: 0;
          background:
            linear-gradient(90deg, rgba(168, 132, 56, 0.72), transparent) 0 0 / 18px 1.5px no-repeat,
            linear-gradient(180deg, rgba(168, 132, 56, 0.72), transparent) 0 0 / 1.5px 18px
              no-repeat,
            linear-gradient(45deg, transparent 42%, rgba(186, 150, 84, 0.78) 50%, transparent 58%)
              2px 2px / 12px 12px no-repeat;
        }

        .books-grid .reader-frame-corner-tl::after {
          top: -1px;
          left: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(172, 136, 56, 0.78);
          box-shadow: 0 0 4px rgba(156, 120, 44, 0.32);
        }

        .books-grid .reader-frame-corner-tr::before {
          inset: 0;
          background:
            linear-gradient(270deg, rgba(168, 132, 56, 0.72), transparent) 100% 0 / 18px 1.5px
              no-repeat,
            linear-gradient(180deg, rgba(168, 132, 56, 0.72), transparent) 100% 0 / 1.5px 18px
              no-repeat,
            linear-gradient(-45deg, transparent 42%, rgba(186, 150, 84, 0.78) 50%, transparent 58%)
              calc(100% - 2px) 2px / 12px 12px no-repeat;
        }

        .books-grid .reader-frame-corner-tr::after {
          top: -1px;
          right: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(172, 136, 56, 0.78);
          box-shadow: 0 0 4px rgba(156, 120, 44, 0.32);
        }

        .books-grid .reader-frame-corner-bl::before {
          inset: 0;
          background:
            linear-gradient(90deg, rgba(168, 132, 56, 0.72), transparent) 0 100% / 18px 1.5px
              no-repeat,
            linear-gradient(0deg, rgba(168, 132, 56, 0.72), transparent) 0 100% / 1.5px 18px
              no-repeat,
            linear-gradient(-45deg, transparent 42%, rgba(186, 150, 84, 0.78) 50%, transparent 58%)
              2px calc(100% - 2px) / 12px 12px no-repeat;
        }

        .books-grid .reader-frame-corner-bl::after {
          bottom: -1px;
          left: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(172, 136, 56, 0.78);
          box-shadow: 0 0 4px rgba(156, 120, 44, 0.32);
        }

        .books-grid .reader-frame-corner-br::before {
          inset: 0;
          background:
            linear-gradient(270deg, rgba(168, 132, 56, 0.72), transparent) 100% 100% / 18px 1.5px
              no-repeat,
            linear-gradient(0deg, rgba(168, 132, 56, 0.72), transparent) 100% 100% / 1.5px 18px
              no-repeat,
            linear-gradient(45deg, transparent 42%, rgba(186, 150, 84, 0.78) 50%, transparent 58%)
              calc(100% - 2px) calc(100% - 2px) / 12px 12px no-repeat;
        }

        .books-grid .reader-frame-corner-br::after {
          bottom: -1px;
          right: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(172, 136, 56, 0.78);
          box-shadow: 0 0 4px rgba(156, 120, 44, 0.32);
        }
      `}</style>
    </div>
  );
};

export default BooksGrid;
