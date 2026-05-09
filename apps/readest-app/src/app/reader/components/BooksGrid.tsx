import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import { resolveBookThemeFromBook } from '@/styles/book-themes';
import { getOrnamentAsset, type OrnamentStyle } from '@/styles/ornaments';
import { getViewInsets } from '@/utils/insets';

// Each ornament PNG is authored for a specific corner of the source image —
// alpha-pixel analysis shows the asset's main shape sits in this quadrant of
// the file. We normalize that to top-left first, then apply the user-prescribed
// per-corner mirror (TL=base, TR=scaleX(-1), BL=scaleY(-1), BR=scale(-1,-1))
// on top, so every corner ornament ends up pointing inward toward the page.
type CornerQuadrant = 'tl' | 'tr' | 'bl' | 'br';

const ORNAMENT_NATURAL_QUADRANT: Record<OrnamentStyle, CornerQuadrant> = {
  gothic: 'tl',
  celestial: 'tl',
  scifi: 'tl',
  arcane: 'bl',
  elegant: 'br',
  'art-deco': 'tl',
};

// Composed transform = (normalize natural → TL) × (user per-corner mirror).
// Pre-computed analytically so the visual result is always inward-facing.
const CORNER_ORIENTATION: Record<CornerQuadrant, Record<CornerQuadrant, string>> = {
  tl: { tl: '', tr: 'scaleX(-1)', bl: 'scaleY(-1)', br: 'scale(-1, -1)' },
  tr: { tl: 'scaleX(-1)', tr: '', bl: 'scale(-1, -1)', br: 'scaleY(-1)' },
  bl: { tl: 'scaleY(-1)', tr: 'scale(-1, -1)', bl: '', br: 'scaleX(-1)' },
  br: { tl: 'scale(-1, -1)', tr: 'scaleY(-1)', bl: 'scaleX(-1)', br: '' },
};

const getCornerTransform = (
  ornamentStyle: OrnamentStyle,
  corner: CornerQuadrant,
): string | undefined => {
  const natural = ORNAMENT_NATURAL_QUADRANT[ornamentStyle] ?? 'tl';
  const t = CORNER_ORIENTATION[natural][corner];
  return t === '' ? undefined : t;
};
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

        const bookTheme = resolveBookThemeFromBook(book);
        const readerBookImage = bookTheme.readerBookImage;
        const cornerAsset = getOrnamentAsset(bookTheme.ornamentStyle, 'corner');

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
        const wellInsetTop = isCompactViewport ? 34 : 40;
        const wellInsetSide = isCompactViewport ? 22 : 44;
        const wellInsetBottom = isCompactViewport ? 64 : 78;
        const spineWidth = isCompactViewport ? 26 : 42;
        const cornerSize = isCompactViewport ? 56 : 78;
        // Corners sit right AT the well's edge so they read as part of
        // the page frame, not floating inside it.
        const cornerInset = isCompactViewport ? 0 : 2;
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
        // Use the ornament PNG as an alpha mask and fill it with a solid antique gold.
        // This way the corner art reads as gold regardless of the source linework color
        // and we keep crisp edges on the dark page well.
        const cornerBase: React.CSSProperties = cornerAsset
          ? ({
              maskImage: `url(${cornerAsset})`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'top left',
              WebkitMaskImage: `url(${cornerAsset})`,
              WebkitMaskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'top left',
              backgroundColor: 'rgba(214, 168, 88, 0.95)',
              filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55))',
            } as React.CSSProperties)
          : {};
        const cornerConfigs: Array<{
          className: string;
          style: React.CSSProperties;
        }> = [
          {
            className: 'reader-frame-corner-tl',
            style: {
              ...cornerBase,
              top: `${wellInsetTop + cornerInset}px`,
              left: `${wellInsetSide + cornerInset}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
              transform: cornerAsset
                ? getCornerTransform(bookTheme.ornamentStyle, 'tl')
                : undefined,
            },
          },
          {
            className: 'reader-frame-corner-tr',
            style: {
              ...cornerBase,
              top: `${wellInsetTop + cornerInset}px`,
              right: `${wellInsetSide + cornerInset}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
              transform: cornerAsset
                ? getCornerTransform(bookTheme.ornamentStyle, 'tr')
                : undefined,
            },
          },
          {
            className: 'reader-frame-corner-bl',
            style: {
              ...cornerBase,
              bottom: `${wellInsetBottom + cornerInset}px`,
              left: `${wellInsetSide + cornerInset}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
              transform: cornerAsset
                ? getCornerTransform(bookTheme.ornamentStyle, 'bl')
                : undefined,
            },
          },
          {
            className: 'reader-frame-corner-br',
            style: {
              ...cornerBase,
              right: `${wellInsetSide + cornerInset}px`,
              bottom: `${wellInsetBottom + cornerInset}px`,
              width: `${cornerSize}px`,
              height: `${cornerSize}px`,
              transform: cornerAsset
                ? getCornerTransform(bookTheme.ornamentStyle, 'br')
                : undefined,
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
            {readerBookImage && (
              <div
                aria-hidden='true'
                className='pointer-events-none absolute inset-0 z-0'
                style={{
                  backgroundImage: `url(${readerBookImage})`,
                  backgroundSize: 'contain',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  opacity: 0.09,
                  filter: 'brightness(0.7) sepia(0.3)',
                  mixBlendMode: 'soft-light',
                }}
              />
            )}
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
            <div className='reader-frame-well pointer-events-none absolute z-0' style={wellStyle} />
            <div
              className='reader-frame-spine pointer-events-none absolute z-[2]'
              style={spineStyle}
            />
            {cornerConfigs.map(({ className, style }) => (
              <div
                key={className}
                aria-hidden='true'
                data-citadel-corner={cornerAsset ? 'png' : 'css'}
                className={clsx(
                  'reader-frame-corner pointer-events-none absolute z-[3]',
                  className,
                )}
                style={style}
              />
            ))}
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
            /* Subtle warm light from above to give the page a lit feel */
            radial-gradient(ellipse 70% 30% at 50% 0%, rgba(232, 188, 124, 0.07), transparent 60%),
            /* Paper grain — tiny dot pattern for tactile depth */
            url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><circle cx='8' cy='12' r='0.5' fill='%23d6a85c' fill-opacity='0.05'/><circle cx='36' cy='28' r='0.5' fill='%23d6a85c' fill-opacity='0.04'/><circle cx='52' cy='48' r='0.5' fill='%23d6a85c' fill-opacity='0.05'/><circle cx='20' cy='52' r='0.5' fill='%23d6a85c' fill-opacity='0.04'/><circle cx='44' cy='8' r='0.4' fill='%23d6a85c' fill-opacity='0.04'/></svg>"),
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
              rgba(40, 26, 20, 0.22) 0%,
              rgba(0, 0, 0, 0.18) 10%,
              transparent 26%,
              transparent 72%,
              rgba(0, 0, 0, 0.16) 90%,
              rgba(0, 0, 0, 0.42) 100%
            );
          background-size:
            auto,
            64px 64px,
            auto,
            auto,
            auto,
            auto,
            auto;
          box-shadow:
            inset 0 0 0 1px rgba(214, 168, 88, 0.42),
            inset 0 0 0 2px rgba(36, 22, 16, 0.55),
            inset 0 0 0 3px rgba(214, 168, 88, 0.14),
            inset 0 18px 30px rgba(255, 230, 186, 0.022),
            inset 0 -34px 46px rgba(0, 0, 0, 0.22),
            inset 18px 0 28px rgba(0, 0, 0, 0.12),
            inset -18px 0 28px rgba(0, 0, 0, 0.12),
            0 0 22px rgba(120, 28, 22, 0.08);
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

        /* ── Corners: PNG variant disables the CSS-drawn flourish ── */
        .books-grid .reader-frame-corner[data-citadel-corner='png']::before,
        .books-grid .reader-frame-corner[data-citadel-corner='png']::after {
          content: none;
        }

        /* ── Corners: antique gold filet with jewel dot at vertex (CSS fallback) ── */
        .books-grid .reader-frame-corner[data-citadel-corner='css']::before,
        .books-grid .reader-frame-corner[data-citadel-corner='css']::after {
          content: '';
          position: absolute;
          pointer-events: none;
        }

        .books-grid .reader-frame-corner-tl[data-citadel-corner='css']::before {
          inset: 0;
          background:
            linear-gradient(90deg, rgba(212, 168, 88, 0.96), transparent) 0 0 / 32px 2px no-repeat,
            linear-gradient(180deg, rgba(212, 168, 88, 0.96), transparent) 0 0 / 2px 32px no-repeat,
            linear-gradient(45deg, transparent 42%, rgba(232, 188, 102, 0.96) 50%, transparent 58%)
              3px 3px / 18px 18px no-repeat;
        }

        .books-grid .reader-frame-corner-tl[data-citadel-corner='css']::after {
          top: -2px;
          left: -2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(212, 168, 88, 0.96);
          box-shadow: 0 0 6px rgba(180, 132, 52, 0.55);
        }

        .books-grid .reader-frame-corner-tr[data-citadel-corner='css']::before {
          inset: 0;
          background:
            linear-gradient(270deg, rgba(212, 168, 88, 0.96), transparent) 100% 0 / 32px 2px
              no-repeat,
            linear-gradient(180deg, rgba(212, 168, 88, 0.96), transparent) 100% 0 / 2px 32px
              no-repeat,
            linear-gradient(-45deg, transparent 42%, rgba(232, 188, 102, 0.96) 50%, transparent 58%)
              calc(100% - 3px) 3px / 18px 18px no-repeat;
        }

        .books-grid .reader-frame-corner-tr[data-citadel-corner='css']::after {
          top: -2px;
          right: -2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(212, 168, 88, 0.96);
          box-shadow: 0 0 6px rgba(180, 132, 52, 0.55);
        }

        .books-grid .reader-frame-corner-bl[data-citadel-corner='css']::before {
          inset: 0;
          background:
            linear-gradient(90deg, rgba(212, 168, 88, 0.96), transparent) 0 100% / 32px 2px
              no-repeat,
            linear-gradient(0deg, rgba(212, 168, 88, 0.96), transparent) 0 100% / 2px 32px no-repeat,
            linear-gradient(-45deg, transparent 42%, rgba(232, 188, 102, 0.96) 50%, transparent 58%)
              3px calc(100% - 3px) / 18px 18px no-repeat;
        }

        .books-grid .reader-frame-corner-bl[data-citadel-corner='css']::after {
          bottom: -2px;
          left: -2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(212, 168, 88, 0.96);
          box-shadow: 0 0 6px rgba(180, 132, 52, 0.55);
        }

        .books-grid .reader-frame-corner-br[data-citadel-corner='css']::before {
          inset: 0;
          background:
            linear-gradient(270deg, rgba(212, 168, 88, 0.96), transparent) 100% 100% / 32px 2px
              no-repeat,
            linear-gradient(0deg, rgba(212, 168, 88, 0.96), transparent) 100% 100% / 2px 32px
              no-repeat,
            linear-gradient(45deg, transparent 42%, rgba(232, 188, 102, 0.96) 50%, transparent 58%)
              calc(100% - 3px) calc(100% - 3px) / 18px 18px no-repeat;
        }

        .books-grid .reader-frame-corner-br[data-citadel-corner='css']::after {
          bottom: -2px;
          right: -2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(212, 168, 88, 0.96);
          box-shadow: 0 0 6px rgba(180, 132, 52, 0.55);
        }

        /* ── Footer page numbers: book-like styling with side flourishes ── */
        .books-grid .progressinfo .progress-info-label {
          color: rgba(220, 184, 116, 0.92);
          font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
          font-size: 0.84rem;
          font-style: italic;
          font-weight: 400;
          letter-spacing: 0.06em;
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
          padding: 0 0.2em;
          display: inline-flex;
          align-items: center;
          gap: 0.55em;
        }

        .books-grid .progressinfo .progress-info-label::before,
        .books-grid .progressinfo .progress-info-label::after {
          content: '';
          display: inline-block;
          width: 22px;
          height: 6px;
          background:
            linear-gradient(
                90deg,
                transparent 0%,
                rgba(214, 168, 88, 0.18) 16%,
                rgba(220, 178, 102, 0.78) 50%,
                rgba(214, 168, 88, 0.18) 84%,
                transparent 100%
              )
              center / 100% 1.2px no-repeat,
            radial-gradient(circle, rgba(228, 188, 116, 0.78) 0 1.2px, transparent 1.5px) center /
              100% 100% no-repeat;
          flex-shrink: 0;
        }

        .books-grid .progressinfo .pages-left-number,
        .books-grid .progressinfo .time-left-label,
        .books-grid .progressinfo .pages-left-label {
          color: rgba(220, 184, 116, 0.78);
          font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
          font-style: italic;
          font-size: 0.78rem;
          letter-spacing: 0.05em;
        }

        .books-grid .reader-frame-shell {
          background: linear-gradient(
            170deg,
            rgb(22, 13, 10) 0%,
            rgb(16, 10, 8) 24%,
            rgb(10, 7, 6) 62%,
            rgba(8, 5, 4, 1) 100%
          );
          box-shadow:
            0 22px 52px rgba(0, 0, 0, 0.48),
            inset 0 0 0 1px rgba(190, 146, 72, 0.7),
            inset 0 0 0 4px rgba(0, 0, 0, 0.55),
            inset 0 0 0 5px rgba(214, 172, 94, 0.2),
            inset 0 0 48px rgba(120, 28, 18, 0.16),
            inset 0 18px 36px rgba(255, 228, 190, 0.014),
            inset 0 -42px 58px rgba(0, 0, 0, 0.5);
        }

        .books-grid .reader-frame-shell::before {
          background: linear-gradient(180deg, rgba(255, 229, 186, 0.018), rgba(0, 0, 0, 0.1));
          box-shadow:
            inset 0 0 0 1px rgba(82, 49, 33, 0.84),
            inset 0 0 0 9px rgba(9, 6, 5, 0.34),
            inset 0 24px 42px rgba(255, 224, 185, 0.016),
            inset 0 -46px 60px rgba(0, 0, 0, 0.42);
          pointer-events: none;
        }

        .books-grid .reader-frame-well {
          background:
            radial-gradient(ellipse 68% 28% at 50% 2%, rgba(232, 188, 124, 0.065), transparent 62%),
            radial-gradient(ellipse 58% 76% at 50% 44%, rgba(96, 64, 38, 0.12), transparent 54%),
            radial-gradient(ellipse 34% 88% at 2% 50%, rgba(0, 0, 0, 0.34), transparent 72%),
            radial-gradient(ellipse 34% 88% at 98% 50%, rgba(0, 0, 0, 0.34), transparent 72%),
            linear-gradient(
              180deg,
              rgba(26, 25, 22, 0.995),
              rgba(16, 16, 14, 1) 38%,
              rgba(11, 11, 10, 1) 100%
            );
          box-shadow:
            inset 0 0 0 1px rgba(190, 142, 66, 0.66),
            inset 0 0 0 3px rgba(0, 0, 0, 0.54),
            inset 0 0 0 5px rgba(214, 172, 94, 0.18),
            inset 0 24px 52px rgba(255, 220, 150, 0.03),
            inset 0 -38px 64px rgba(0, 0, 0, 0.46),
            inset 22px 0 32px rgba(0, 0, 0, 0.14),
            inset -22px 0 32px rgba(0, 0, 0, 0.14),
            0 12px 28px rgba(0, 0, 0, 0.38);
        }

        .books-grid .reader-frame-footer-seat {
          background: linear-gradient(180deg, rgb(10, 7, 5), rgb(3, 2, 2));
          box-shadow:
            inset 0 1px 0 rgba(255, 220, 140, 0.1),
            inset 0 22px 36px rgba(0, 0, 0, 0.44),
            inset 1px 0 0 rgba(184, 132, 54, 0.14),
            inset -1px 0 0 rgba(184, 132, 54, 0.14);
        }
      `}</style>
    </div>
  );
};

export default BooksGrid;
