import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getGridTemplate, getInsetEdges } from '@/utils/grid';
import { tauriSetWindowTitle } from '@/utils/window';
import { useContentInsets } from '../hooks/useContentInsets';
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
import SidebarToggler from './SidebarToggler';
import BookmarkToggler from './BookmarkToggler';
import TranslationToggler from './TranslationToggler';
import NotebookToggler from './NotebookToggler';
import ViewMenu from './ViewMenu';
import Dropdown from '@/components/Dropdown';
import { useNotebookStore } from '@/store/notebookStore';
import { MdArrowBackIosNew, MdArrowForwardIos, MdMenu, MdMenuBook } from 'react-icons/md';
import { useAIChatStore } from '@/store/aiChatStore';

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
  screenInsets: Insets;
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
  gridInsets,
  screenInsets,
  appServiceHasRoundedWindow,
  isHoveredAnim,
  hoveredBookKey,
  isDropdownOpen,
  setDropdownOpenForBook,
  onCloseBook,
  onGoToLibrary,
}) => {
  const _ = useTranslation();
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
  const viewSettings = viewState?.viewSettings ?? null;

  // config / bookData are read imperatively: their relevant fields are
  // written alongside progress (setProgress / saveConfig), so the
  // subscriptions above already drive the re-render that picks them up.
  const bookData = getBookData(bookKey);
  const config = getConfig(bookKey);
  const { book, bookDoc } = bookData || {};
  const setNotebookVisible = useNotebookStore((s) => s.setNotebookVisible);
  const setNotebookPin = useNotebookStore((s) => s.setNotebookPin);
  const setNotebookActiveTab = useNotebookStore((s) => s.setNotebookActiveTab);
  const getView = useReaderStore((s) => s.getView);
  const setSideBarBookKey = useSidebarStore((s) => s.setSideBarBookKey);
  const setSideBarVisible = useSidebarStore((s) => s.setSideBarVisible);
  const conversations = useAIChatStore((state) => state.conversations);
  const loadConversations = useAIChatStore((state) => state.loadConversations);
  const activeConversationId = useAIChatStore((state) => state.activeConversationId);
  const setActiveConversation = useAIChatStore((state) => state.setActiveConversation);
  const isPdf = book?.format === 'PDF';
  const bookHash = bookKey.split('-')[0] || '';
  const [pdfPageCount, setPdfPageCount] = useState(1);

  useEffect(() => {
    if (isPdf && bookHash) void loadConversations(bookHash);
  }, [bookHash, isPdf, loadConversations]);

  const handlePdfPageCount = useCallback((total: number) => {
    setPdfPageCount((previous) => (previous === total ? previous : total));
  }, []);

  // viewInsets/contentInsets stay stable while the user is just turning pages
  // (margins are unchanged) but update when a margin setting changes — even
  // though saveViewSettings mutates viewSettings in place (#4898).
  const { viewInsets, contentInsets } = useContentInsets(viewSettings, gridInsets);

  // The page content (viewer + its header/footer chrome) that the pull-down
  // bookmark gesture slides as one block.
  const slideRef = useRef<HTMLDivElement | null>(null);

  // Stable callback so HeaderBar doesn't see a new prop reference per
  // BooksGrid render.
  const onDropdownOpenChange = useCallback(
    (isOpen: boolean) => setDropdownOpenForBook(bookKey, isOpen),
    [bookKey, setDropdownOpenForBook],
  );

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      void setActiveConversation(conversationId);
      setNotebookActiveTab('ai');
      setNotebookPin(true);
      setNotebookVisible(true);
    },
    [setActiveConversation, setNotebookActiveTab, setNotebookPin, setNotebookVisible],
  );

  const handleOpenContents = useCallback(() => {
    setSideBarBookKey(bookKey);
    setSideBarVisible(true);
  }, [bookKey, setSideBarBookKey, setSideBarVisible]);

  if (!book || !config || !bookDoc || !viewSettings || !viewState) return null;

  const { section, pageinfo, sectionLabel } = progress || {};
  const viewerKey = viewState.viewerKey;
  const horizontalGapPercent = viewSettings.gapPercent;
  const showHeader = viewSettings.showHeader;
  const showFooter = viewSettings.showFooter;
  const anchoredConversations = isPdf
    ? conversations
        .filter((conversation) => conversation.bookHash === bookHash && conversation.anchor)
        .sort((left, right) => (left.anchor?.page ?? 0) - (right.anchor?.page ?? 0))
    : [];

  return (
    <div
      id={`gridcell-${bookKey}`}
      // Layered page turns (slide/curl) snapshot this element, so the page
      // header and footer rendered as siblings of the viewer turn with the
      // page in both layers.
      data-view-transition-root=''
      className={clsx(
        'relative h-full w-full overflow-hidden',
        isPdf && 'flex flex-col',
        isPdf && 'pdf-reader-cell',
        appServiceHasRoundedWindow && 'rounded-window',
      )}
    >
      {isPdf ? (
        <div className='pdf-reader-topbar grid h-14 shrink-0 grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)] items-center gap-3 border-b border-base-content/10 bg-base-100 px-4'>
          <div className='flex min-w-0 items-center gap-3'>
            <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-content'>
              R
            </div>
            <div className='min-w-0'>
              <div className='truncate text-sm font-semibold'>AI 学术阅读器</div>
              <div className='truncate text-[11px] text-base-content/60'>深度阅读工作台</div>
            </div>
          </div>
          <div className='flex items-center justify-center gap-1'>
            <button
              type='button'
              className='btn btn-ghost btn-sm btn-square'
              aria-label='目录'
              title='目录'
              onClick={handleOpenContents}
            >
              <MdMenuBook size={18} />
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-sm btn-square'
              aria-label='上一页'
              title='上一页'
              onClick={() => getView(bookKey)?.goLeft()}
            >
              <MdArrowBackIosNew size={16} />
            </button>
            <span className='hidden max-w-60 truncate rounded-full border border-base-content/10 px-3 py-1.5 text-xs text-base-content/70 md:inline-flex'>
              {sectionLabel || 'PDF 原版阅读'}
            </span>
            <button
              type='button'
              className='btn btn-ghost btn-sm btn-square'
              aria-label='下一页'
              title='下一页'
              onClick={() => getView(bookKey)?.goRight()}
            >
              <MdArrowForwardIos size={16} />
            </button>
          </div>
          <div className='flex min-w-0 items-center justify-end gap-1.5 text-xs text-base-content/60'>
            <span className='hidden sm:inline'>共 {pdfPageCount} 页</span>
            <Dropdown
              label='显示设置'
              className='dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost btn-sm h-8 min-h-8 px-2'
              toggleButton={<span aria-hidden='true'>Aa</span>}
              onToggle={onDropdownOpenChange}
            >
              <ViewMenu bookKey={bookKey} />
            </Dropdown>
          </div>
        </div>
      ) : (
        <HeaderBar
          bookKey={bookKey}
          gridInsets={gridInsets}
          screenInsets={screenInsets}
          bookTitle={book.title}
          isTopLeft={index === 0}
          isHoveredAnim={isHoveredAnim}
          onCloseBook={onCloseBook}
          onGoToLibrary={onGoToLibrary}
          onDropdownOpenChange={onDropdownOpenChange}
        />
      )}
      {isPdf && (
        <div className='pdf-floating-toolbar' role='toolbar' aria-label='阅读工具'>
          <SidebarToggler bookKey={bookKey} />
          <BookmarkToggler bookKey={bookKey} />
          <TranslationToggler bookKey={bookKey} />
          <NotebookToggler bookKey={bookKey} />
          <Dropdown
            label='更多阅读设置'
            className='dropdown-bottom dropdown-end'
            buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
            toggleButton={<MdMenu />}
            onToggle={onDropdownOpenChange}
          >
            <ViewMenu bookKey={bookKey} />
          </Dropdown>
        </div>
      )}
      {/*
        bg-base-100: while the pull-down bookmark gesture translates this
        wrapper, the transform makes it a stacking context, which isolates the
        texture's mix-blend-mode (.foliate-viewer::before) from any backdrop
        outside it — the page visibly brightens for the duration of the drag.
        An opaque background inside the wrapper keeps the blend backdrop with
        the transformed group, so the drag is luminance-invariant.
      */}
      <div
        ref={slideRef}
        className={clsx(
          'bg-base-100',
          isPdf ? 'pdf-reader-stage relative min-h-0 flex-1' : 'absolute inset-0',
        )}
      >
        <FoliateViewer
          key={viewerKey}
          bookKey={bookKey}
          bookDoc={bookDoc}
          config={config}
          gridInsets={gridInsets}
          contentInsets={contentInsets}
          className={isPdf ? 'pdf-reader-viewer' : undefined}
          onPdfPageCount={isPdf ? handlePdfPageCount : undefined}
        />
        {isPdf && anchoredConversations.length > 0 && (
          <aside className='pdf-annotation-rail' aria-label={_('PDF annotations')}>
            {anchoredConversations.map((conversation, conversationIndex) => (
              <button
                key={conversation.id}
                type='button'
                className={clsx(
                  'pdf-annotation-dot',
                  activeConversationId === conversation.id && 'is-active',
                )}
                style={{
                  top: `${Math.max(5, Math.min(92, (((conversation.anchor?.page ?? 1) - 0.5) / Math.max(pageinfo?.total ?? 1, 1)) * 100))}%`,
                }}
                aria-label={`打开批注 ${conversationIndex + 1}`}
                title={conversation.anchor?.text}
                onClick={() => handleOpenConversation(conversation.id)}
              >
                <span>✦</span>
                <small>{conversationIndex + 1}</small>
              </button>
            ))}
          </aside>
        )}
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
      </div>
      <BookmarkPullDown bookKey={bookKey} ribbonHidden={!!hoveredBookKey} slideRef={slideRef} />
      <PageNavigationButtons bookKey={bookKey} isDropdownOpen={isDropdownOpen} />
      <SearchResultsNav bookKey={bookKey} gridInsets={gridInsets} />
      <BooknotesNav bookKey={bookKey} gridInsets={gridInsets} toc={bookDoc.toc || []} />
      <FootnotePopup bookKey={bookKey} bookDoc={bookDoc} />
      {/* After FootnotePopup so the lookup popups stack above the footnote
          popup (and its dismiss overlay) when the user selects text inside it.
          The selection toolbar no longer rides on this order — it has its own
          z-[43] band, above the footnote popup's z-[42] (#6145). */}
      <Annotator bookKey={bookKey} contentInsets={contentInsets} />
      <FooterBar
        bookKey={bookKey}
        bookFormat={book.format}
        section={section}
        pageinfo={pageinfo}
        isHoveredAnim={false}
        gridInsets={gridInsets}
      />
      <ReadingStatsTracker bookKey={bookKey} />
    </div>
  );
};

const BookCell = React.memo(BookCellInner);

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

  const { safeAreaInsets: screenInsets } = useThemeStore();
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
  const perBookGridInsets = useMemo<Insets[]>(() => {
    if (!screenInsets) return [];
    return bookKeys.map((_bookKey, index) => {
      const { top, right, bottom, left } = getInsetEdges(index, bookKeys.length, aspectRatio);
      return {
        top: top ? screenInsets.top : 0,
        right: right ? screenInsets.right : 0,
        bottom: bottom ? screenInsets.bottom : 0,
        left: left ? screenInsets.left : 0,
      };
    });
    // aspectRatio is recomputed every render but its value is window-derived
    // and won't change between resizes; including it explicitly so an
    // orientation change still busts the cache.
  }, [bookKeys, screenInsets, aspectRatio]);

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
          screenInsets={screenInsets}
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
