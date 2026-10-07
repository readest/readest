import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import { expectsColumnSpread } from '@/utils/config';
import { getPageAreaInsets, getReadingScreenInsets, getSpreadColumnGap } from '@/utils/insets';
import { tauriSetWindowTitle } from '@/utils/window';
import { useContentInsets } from '../hooks/useContentInsets';
import { usePageOverflow } from '../hooks/usePageOverflow';
import { type BottomCornerRadii, getCellCornerRadii, NO_CORNERS } from '../utils/footerBand';
import SearchResultsNav from './sidebar/SearchResultsNav';
import BooknotesNav from './sidebar/BooknotesNav';
import FoliateViewer from './FoliateViewer';
import SectionInfo from './SectionInfo';
import HeaderBar from './HeaderBar';
import PageNavigationButtons from './PageNavigationButtons';
import FooterBar from './footerbar/FooterBar';
import ProgressBar from './ProgressBar';
import BookmarkPullDown from './BookmarkPullDown';
import Annotator from './annotator/Annotator';
import FootnotePopup from './FootnotePopup';
import HintInfo from './HintInfo';
import ReadingRuler from './ReadingRuler';
import DoubleBorder from './DoubleBorder';
import ReadingStatsTracker from './ReadingStatsTracker';

interface BooksGridProps {
  bookKeys: string[];
  onCloseBook: (bookKey: string) => void;
  onGoToLibrary: () => void;
}

/**
 * Per-book cell rendered inside the parent grid.
 *
 * Why this is its own component:
 *   - Previously BooksGrid subscribed to the *entire* `progresses` map
 *     and rendered every book inline. The map changes on every page
 *     turn, so the whole `bookKeys.map(...)` body re-ran for every
 *     swipe and every grandchild had to be re-reconciled.
 *   - On top of that, inset-related objects (`gridInsets`,
 *     `contentInsets`) were rebuilt every render and threaded into
 *     7+ children as props. React saw a fresh reference every time,
 *     so even unchanged children couldn't bail out — the commit
 *     traversal (the `up` / `ud` / `iv` recursion in the React
 *     reconciler) ran through the entire BooksGrid subtree per turn
 *     and accounted for 27% main-thread time in the Bottom-Up profile
 *     ("Animation Frame Fired" 2.6 s / 27 %).
 *
 * What this fixes:
 *   - Each BookCell subscribes only to its own book's progress via
 *     `useBookProgress(bookKey)`. A page turn re-renders one BookCell,
 *     not the entire grid.
 *   - `gridInsets` and `contentInsets` are memoized off their numeric
 *     inputs so children get stable prop references across renders.
 *   - The dropdown handler is built via useCallback so HeaderBar's
 *     props object stays stable.
 *   - The component is wrapped in React.memo at export so the parent
 *     can re-render (e.g. when bookKeys changes) without forcing this
 *     cell to.
 */
interface BookCellProps {
  bookKey: string;
  index: number;
  gridInsets: Insets;
  // The cell's live insets, for the toolbar chrome that shows with the status
  // bar; gridInsets are the reading page's (see getReadingScreenInsets). The
  // same as gridInsets except on iPhone Duo.
  chromeInsets: Insets;
  // Both of the cell's side edges are screen edges (a full-width cell).
  spansWidth: boolean;
  screenInsets: Insets;
  // Rounded screen corners this cell's bottom edge meets.
  cornerRadii: BottomCornerRadii;
  appServiceHasRoundedWindow: boolean;
  isHoveredAnim: boolean;
  hoveredBookKey: string | null;
  isDropdownOpen: boolean;
  setDropdownOpenForBook: (bookKey: string, isOpen: boolean) => void;
  onCloseBook: (bookKey: string) => void;
  onGoToLibrary: () => void;
}

const BookCellInner: React.FC<BookCellProps> = ({
  bookKey,
  index,
  gridInsets: cellInsets,
  chromeInsets: chromeCellInsets,
  spansWidth,
  screenInsets,
  cornerRadii,
  appServiceHasRoundedWindow,
  isHoveredAnim,
  hoveredBookKey,
  isDropdownOpen,
  setDropdownOpenForBook,
  onCloseBook,
  onGoToLibrary,
}) => {
  // Per-field selectors — see store/readerProgressStore.ts header for the
  // "destructure-subscribes-the-whole-store" rationale.
  const getConfig = useBookDataStore((s) => s.getConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);

  // Per-cell reactive subscriptions. This cell re-renders when THIS book's
  // progress changes (page turns) OR its view state changes. Both are
  // needed: viewState carries `viewSettings` and `ribbonVisible`, which
  // gate the chrome this cell mounts (Show Header / Show Footer, Double
  // Border, bookmark Ribbon). Those settings save with applyStyles=false
  // and the ribbon toggle writes no progress, so without a viewState
  // subscription the toggles wouldn't take effect until the next page turn.
  //
  // Subscribing to the per-book slice is safe now that progress lives in
  // its own store: `viewStates[key]` only bumps on low-frequency events
  // (settings toggles, ribbon, init, sync), never on the per-swipe
  // relocate path — so this does NOT reintroduce the commit storm the
  // progress-store split removed.
  const progress = useBookProgress(bookKey);
  const viewState = useReaderStore((s) => s.viewStates[bookKey]);
  const getView = useReaderStore((s) => s.getView);
  const viewSettings = viewState?.viewSettings ?? null;

  // On iPhone Duo a two-column spread is centred on the display (spine on the
  // fold) by making the cell's horizontal insets symmetric; everything in the
  // cell lays out against these (#6307). Cells that share the screen have an
  // inset on their outer edge only, so a symmetric pad would leave a dead band
  // against their neighbour. Off the Duo the cell's insets are used as they are.
  const isIPhoneDuo = useThemeStore((s) => s.isIPhoneDuo);
  const isSpread =
    isIPhoneDuo &&
    spansWidth &&
    !!viewSettings &&
    expectsColumnSpread(viewSettings, window.innerWidth - cellInsets.left - cellInsets.right);
  const gridInsets = useMemo(() => getPageAreaInsets(cellInsets, isSpread), [cellInsets, isSpread]);
  const chromeGridInsets = useMemo(
    () => getPageAreaInsets(chromeCellInsets, isSpread),
    [chromeCellInsets, isSpread],
  );

  // config / bookData are read imperatively: their relevant fields are
  // written alongside progress (setProgress / saveConfig), so the
  // subscriptions above already drive the re-render that picks them up.
  const bookData = getBookData(bookKey);
  const config = getConfig(bookKey);
  const { book, bookDoc } = bookData || {};

  // viewInsets/contentInsets stay stable while the user is just turning pages
  // (margins are unchanged) but update when a margin setting changes — even
  // though saveViewSettings mutates viewSettings in place (#4898).
  const { viewInsets, contentInsets } = useContentInsets(viewSettings, gridInsets);
  // A fixed-layout page fills the screen in fit-page mode; zoomed in or
  // scrolled, its header and footer would cover its content, so they hide
  // (#6596).
  const pageOverflowing = usePageOverflow(
    getView(bookKey)?.renderer,
    !!bookData?.isFixedLayout && !viewSettings?.vertical,
  );

  // The page content (viewer + its header/footer chrome) that the pull-down
  // bookmark gesture slides as one block.
  const slideRef = useRef<HTMLDivElement | null>(null);

  // Stable callback so HeaderBar doesn't see a new prop reference per
  // BooksGrid render.
  const onDropdownOpenChange = useCallback(
    (isOpen: boolean) => setDropdownOpenForBook(bookKey, isOpen),
    [bookKey, setDropdownOpenForBook],
  );

  if (!book || !config || !bookDoc || !viewSettings || !viewState) return null;

  const { section, pageinfo, sectionLabel } = progress || {};
  const viewerKey = viewState.viewerKey;
  const horizontalGapPercent = viewSettings.gapPercent;
  // Read on each relocate, which also follows a 1 <-> 2 column re-layout.
  const columnGap = getSpreadColumnGap(viewSettings, getView(bookKey)?.renderer?.columnCount ?? 1);
  const showHeader = viewSettings.showHeader;
  const showFooter = viewSettings.showFooter;

  return (
    <div
      id={`gridcell-${bookKey}`}
      // Layered page turns (slide/curl) snapshot this element, so the page
      // header and footer rendered as siblings of the viewer turn with the
      // page in both layers.
      data-view-transition-root=''
      className={clsx(
        'relative h-full w-full overflow-hidden',
        appServiceHasRoundedWindow && 'rounded-window',
      )}
    >
      <HeaderBar
        bookKey={bookKey}
        gridInsets={chromeGridInsets}
        screenInsets={screenInsets}
        bookTitle={book.title}
        isTopLeft={index === 0}
        isHoveredAnim={isHoveredAnim}
        onCloseBook={onCloseBook}
        onGoToLibrary={onGoToLibrary}
        onDropdownOpenChange={onDropdownOpenChange}
      />
      {/*
        bg-base-100: while the pull-down bookmark gesture translates this
        wrapper, the transform makes it a stacking context, which isolates the
        texture's mix-blend-mode (.foliate-viewer::before) from any backdrop
        outside it — the page visibly brightens for the duration of the drag.
        An opaque background inside the wrapper keeps the blend backdrop with
        the transformed group, so the drag is luminance-invariant.
      */}
      <div ref={slideRef} className='bg-base-100 absolute inset-0'>
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
                  width: `calc(${contentInsets.left + (viewSettings.doubleBorder ? 32 : 0)}px)`,
                  height: `calc(100%)`,
                }}
              />
            )}
            {(showHeader || viewSettings.doubleBorder) && (
              <div
                className='bg-base-100 absolute right-0 top-0 h-full'
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
            columnGap={columnGap}
            hidden={pageOverflowing}
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
          columnGap={columnGap}
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
            columnGap={columnGap}
            cornerRadii={cornerRadii}
            hidden={pageOverflowing}
          />
        )}
      </div>
      <BookmarkPullDown bookKey={bookKey} ribbonHidden={!!hoveredBookKey} slideRef={slideRef} />
      <PageNavigationButtons bookKey={bookKey} isDropdownOpen={isDropdownOpen} />
      <SearchResultsNav bookKey={bookKey} gridInsets={gridInsets} />
      <BooknotesNav bookKey={bookKey} gridInsets={gridInsets} toc={bookDoc.toc || []} />
      <FootnotePopup bookKey={bookKey} bookDoc={bookDoc} gridInsets={gridInsets} />
      {/* After FootnotePopup so the lookup popups stack above the footnote
          popup (and its dismiss overlay) when the user selects text inside it.
          The selection toolbar no longer rides on this order — it has its own
          z-[43] band, above the footnote popup's z-[42] (#6145). */}
      <Annotator bookKey={bookKey} contentInsets={contentInsets} gridInsets={gridInsets} />
      <FooterBar
        bookKey={bookKey}
        bookFormat={book.format}
        section={section}
        pageinfo={pageinfo}
        isHoveredAnim={false}
        gridInsets={chromeGridInsets}
      />
      <ReadingStatsTracker bookKey={bookKey} />
    </div>
  );
};

const BookCell = React.memo(BookCellInner);

const getPerBookInsets = (bookKeys: string[], insets: Insets | null, aspectRatio: number) => {
  if (!insets) return [];
  return bookKeys.map((_bookKey, index) => {
    const { top, right, bottom, left } = getInsetEdges(index, bookKeys.length, aspectRatio);
    return {
      top: top ? insets.top : 0,
      right: right ? insets.right : 0,
      bottom: bottom ? insets.bottom : 0,
      left: left ? insets.left : 0,
    };
  });
};

const cellSpansWidth = (index: number, count: number, aspectRatio: number) => {
  const { left, right } = getInsetEdges(index, count, aspectRatio);
  return left && right;
};

const BooksGrid: React.FC<BooksGridProps> = ({ bookKeys, onCloseBook, onGoToLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  // Per-field selectors — see store/readerProgressStore.ts header. The grid
  // only re-renders on hoveredBookKey changes (header/footer toggle);
  // setGridInsets is a stable action ref.
  const hoveredBookKey = useReaderStore((s) => s.hoveredBookKey);
  const setGridInsets = useReaderStore((s) => s.setGridInsets);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const sideBarBookKey = useSidebarStore((s) => s.sideBarBookKey);
  const [dropdownOpenBook, setDropdownOpenBook] = useState<string>('');

  const {
    safeAreaInsets: screenInsets,
    statusBarHiddenInsets,
    isIPhoneDuo,
    screenCornerRadius,
  } = useThemeStore();
  const alwaysShowStatusBar = useSettingsStore((s) => s.settings.alwaysShowStatusBar);
  const aspectRatio = window.innerWidth / window.innerHeight;
  const gridTemplate = getGridTemplate(bookKeys.length, aspectRatio);

  useEffect(() => {
    if (!sideBarBookKey) return;
    const bookData = getBookData(sideBarBookKey);
    if (!bookData || !bookData.book) return;
    document.title = bookData.book.title;
    // The OS window title is invisible but is what Alt+Tab and screen readers
    // announce, so name the book there too — otherwise every window is just
    // "Readest" and blind users cannot tell them apart.
    if (appService?.hasWindow) {
      tauriSetWindowTitle(bookData.book.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey, appService?.hasWindow]);

  // Memoize the per-book grid insets array — its identity is the input
  // to BookCell.gridInsets, and BookCell is React.memo'd. As long as
  // bookKeys / screenInsets / aspectRatio don't change, the cells'
  // gridInsets props stay reference-equal across renders.
  const perBookChromeInsets = useMemo<Insets[]>(
    () => getPerBookInsets(bookKeys, screenInsets, aspectRatio),
    // aspectRatio is recomputed every render but its value is window-derived
    // and won't change between resizes; including it explicitly so an
    // orientation change still busts the cache.
    [bookKeys, screenInsets, aspectRatio],
  );
  // On iPhone Duo the reading page keeps the side insets seen with the status
  // bar hidden, so showing the toolbar (and with it the status strip) does not
  // re-paginate. Elsewhere there is no record to apply: the page and the chrome
  // share the live insets.
  const perBookGridInsets = useMemo<Insets[]>(() => {
    const readingInsets =
      screenInsets &&
      getReadingScreenInsets(
        screenInsets,
        isIPhoneDuo && !alwaysShowStatusBar ? statusBarHiddenInsets : null,
        window.innerWidth,
        window.innerHeight,
      );
    return getPerBookInsets(bookKeys, readingInsets, aspectRatio);
  }, [
    bookKeys,
    screenInsets,
    statusBarHiddenInsets,
    isIPhoneDuo,
    alwaysShowStatusBar,
    aspectRatio,
  ]);

  // Memoized like perBookGridInsets so the React.memo'd cells keep stable props.
  const perBookCornerRadii = useMemo<BottomCornerRadii[]>(
    () =>
      bookKeys.map((_bookKey, index) =>
        getCellCornerRadii(index, bookKeys.length, aspectRatio, screenCornerRadius),
      ),
    [bookKeys, screenCornerRadius, aspectRatio],
  );

  useEffect(() => {
    if (!screenInsets) return;
    bookKeys.forEach((bookKey, index) => {
      const insets = perBookGridInsets[index];
      if (insets) setGridInsets(bookKey, insets);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys, screenInsets, perBookGridInsets]);

  // Stable cross-cell setter for the dropdown bookkeeping — used by the
  // memoized onDropdownOpenChange callback inside each BookCell.
  const setDropdownOpenForBook = useCallback((bookKey: string, isOpen: boolean) => {
    setDropdownOpenBook(isOpen ? bookKey : '');
  }, []);

  if (!screenInsets) return null;

  const gridStyle = {
    gridTemplateColumns: gridTemplate.columns,
    gridTemplateRows: gridTemplate.rows,
  };
  const isHoveredAnim = bookKeys.length > 2;
  const appServiceHasRoundedWindow = !!appService?.hasRoundedWindow;

  return (
    <div
      className={clsx('books-grid bg-base-100 relative grid h-full grow')}
      style={gridStyle}
      role='main'
      aria-label={_('Books Content')}
    >
      {bookKeys.map((bookKey, index) => (
        <BookCell
          key={bookKey}
          bookKey={bookKey}
          index={index}
          gridInsets={perBookGridInsets[index]!}
          chromeInsets={perBookChromeInsets[index]!}
          spansWidth={cellSpansWidth(index, bookKeys.length, aspectRatio)}
          screenInsets={screenInsets}
          cornerRadii={perBookCornerRadii[index] ?? NO_CORNERS}
          appServiceHasRoundedWindow={appServiceHasRoundedWindow}
          isHoveredAnim={isHoveredAnim}
          hoveredBookKey={hoveredBookKey}
          isDropdownOpen={dropdownOpenBook === bookKey}
          setDropdownOpenForBook={setDropdownOpenForBook}
          onCloseBook={onCloseBook}
          onGoToLibrary={onGoToLibrary}
        />
      ))}
    </div>
  );
};

export default BooksGrid;
