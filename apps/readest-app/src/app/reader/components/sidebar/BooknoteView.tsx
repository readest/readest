import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import * as CFI from 'foliate-js/epubcfi.js';
import { PiMagnifyingGlass, PiNotePencil } from 'react-icons/pi';
import { RiBookmark3Line, RiBookmarkLine } from 'react-icons/ri';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findTocItemBS } from '@/services/nav';
import { findNearestCfi } from '@/utils/cfi';
import { TOCItem } from '@/libs/document';
import {
  BookNote,
  BooknoteGroup,
  BookNoteType,
  HighlightColor,
  HighlightStyle,
} from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import {
  filterBooknotes,
  collectAnnotationFacets,
  summarizeAnnotations,
  AnnotationFilterKind,
} from '../../utils/annotatorUtil';
import AnnotationsToolbar from './AnnotationsToolbar';
import BooknoteItem from './BooknoteItem';
import EmptyState from '../EmptyState';

type FlatBooknoteRow =
  | { kind: 'group-header'; key: string; group: BooknoteGroup }
  | {
      kind: 'note';
      key: string;
      group: BooknoteGroup;
      item: BookNote;
      indexInGroup: number;
    };

const BooknoteView: React.FC<{
  type: BookNoteType;
  bookKey: string;
  toc: TOCItem[];
}> = ({ type, bookKey, toc }) => {
  const _ = useTranslation();
  const { getConfig } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const { setActiveBooknoteType, setBooknoteResults, isSearchBarVisible, setSearchBarVisible } =
    useSidebarStore();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey);
  const allNotes = config.booknotes ?? [];

  const [filterKind, setFilterKind] = useState<AnnotationFilterKind>('all');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [excludedColors, setExcludedColors] = useState<HighlightColor[]>([]);
  const [excludedStyles, setExcludedStyles] = useState<HighlightStyle[]>([]);

  // Debounce the query the same 300 ms the Notebook SearchBar uses, so
  // typing doesn't regroup/re-sort hundreds of notes per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(searchInput), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // The sidebar header's search icon owns the annotation search visibility;
  // whenever the search closes (icon toggle, Escape, tab switch), the query
  // is cleared so a hidden filter can't keep narrowing the list.
  useEffect(() => {
    if (!isSearchBarVisible) {
      setSearchInput('');
    }
  }, [isSearchBarVisible]);

  const isFiltering =
    type === 'annotation' &&
    (filterKind !== 'all' ||
      query.trim().length > 0 ||
      excludedColors.length > 0 ||
      excludedStyles.length > 0);

  const toggleColor = useCallback((color: HighlightColor) => {
    setExcludedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  }, []);

  const toggleStyle = useCallback((style: HighlightStyle) => {
    setExcludedStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style],
    );
  }, []);

  const resetFilters = useCallback(() => {
    setFilterKind('all');
    setExcludedColors([]);
    setExcludedStyles([]);
  }, []);

  // Live annotations drive both the facet row (distinct colors/styles) and
  // the greyed-out state of "Clear Annotations" (mirrors BookMenu).
  const liveAnnotations = useMemo(
    () => allNotes.filter((note) => note.type === 'annotation' && !note.deletedAt),
    [allNotes],
  );
  const facets = useMemo(() => collectAnnotationFacets(liveAnnotations), [liveAnnotations]);
  const counts = useMemo(() => summarizeAnnotations(liveAnnotations), [liveAnnotations]);

  // Filter active notes of this type, then apply the hub's kind/query/facet
  // filter (annotation tab only). useMemo so referential stability flows
  // through derived data and prevents needless recomputation when unrelated
  // config fields change (e.g. viewSettings, lastUpdated).
  const filteredNotes = useMemo(() => {
    if (type !== 'annotation') {
      return allNotes.filter((note) => note.type === type && !note.deletedAt);
    }
    return filterBooknotes(liveAnnotations, {
      kind: filterKind,
      query,
      excludedColors,
      excludedStyles,
    });
  }, [allNotes, liveAnnotations, type, filterKind, query, excludedColors, excludedStyles]);

  // Build groups + sort by toc id and intra-group cfi.
  const sortedGroups = useMemo<BooknoteGroup[]>(() => {
    const groups: { [href: string]: BooknoteGroup } = {};
    for (const booknote of filteredNotes) {
      const tocItem = findTocItemBS(toc ?? [], booknote.cfi);
      const href = tocItem?.href || '';
      const label = tocItem?.label || '';
      const id = tocItem?.id || 0;
      if (!groups[href]) {
        groups[href] = { id, href, label, booknotes: [] };
      }
      groups[href].booknotes.push(booknote);
    }
    Object.values(groups).forEach((g) => {
      g.booknotes.sort((a, b) => CFI.compare(a.cfi, b.cfi));
    });
    return Object.values(groups).sort((a, b) => a.id - b.id);
  }, [filteredNotes, toc]);

  // Flatten group/item tree into a single virtualizable list.
  const flatItems = useMemo<FlatBooknoteRow[]>(() => {
    const rows: FlatBooknoteRow[] = [];
    for (const group of sortedGroups) {
      rows.push({ kind: 'group-header', key: `h-${group.href}`, group });
      group.booknotes.forEach((item, indexInGroup) => {
        rows.push({
          kind: 'note',
          key: `n-${group.href}-${indexInGroup}-${item.cfi}`,
          group,
          item,
          indexInGroup,
        });
      });
    }
    return rows;
  }, [sortedGroups]);

  // Nearest cfi for "current" highlight; sortedGroups identity tracks content
  // changes so stale cached cfis aren't kept after a delete/edit.
  const nearestCfi = useMemo(() => {
    const allSorted: string[] = [];
    for (const g of sortedGroups) {
      for (const n of g.booknotes) allSorted.push(n.cfi);
    }
    return findNearestCfi(allSorted, progress?.location);
  }, [progress?.location, sortedGroups]);

  // Index of the nearest note in the flattened list (-1 when none). Memoized so
  // the scroll effect and the OverlayScrollbars `initialized` callback share a
  // single source of truth.
  const nearestIndex = useMemo(
    () =>
      nearestCfi
        ? flatItems.findIndex((row) => row.kind === 'note' && row.item.cfi === nearestCfi)
        : -1,
    [nearestCfi, flatItems],
  );

  const handleBrowseBookNotes = useCallback(() => {
    if (filteredNotes.length === 0) return;
    const sorted = [...filteredNotes].sort((a, b) => CFI.compare(a.cfi, b.cfi));
    setActiveBooknoteType(bookKey, type);
    setBooknoteResults(bookKey, sorted);
  }, [filteredNotes, bookKey, type, setActiveBooknoteType, setBooknoteResults]);

  // ---- Virtualization wiring (mirrors TOCView pattern) ----
  const listHostRef = useRef<HTMLDivElement | null>(null);
  const osRootRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const lastScrolledCfiRef = useRef<string | null>(null);

  // Mirror the nearest index so the OverlayScrollbars `initialized` callback —
  // created at mount but fired after a deferred, timing-dependent init — reads
  // the current target instead of its stale mount-time closure.
  const nearestIndexRef = useRef(nearestIndex);
  nearestIndexRef.current = nearestIndex;

  // Center index of the currently visible window, kept fresh by Virtuoso's
  // rangeChanged. Lets the scroll effect jump instantly for far moves and
  // animate only short ones (mirrors TOCView).
  const visibleCenterRef = useRef(0);

  // When the reading position is already known at open time (the common case of
  // switching to the panel while reading), mount Virtuoso *natively* centered on
  // the nearest note via initialTopMostItemIndex. A scrollToIndex against a
  // freshly mounted, unmeasured list no-ops (smooth) or wedges it, so the scroll
  // effect skips that first jump and lets initialTopMostItemIndex handle it; the
  // OverlayScrollbars `initialized` re-apply restores it after the deferred init
  // resets scrollTop (mirrors TOCView).
  const [initialTopIndex] = useState(() => nearestIndex);
  const initialScrollHandledRef = useRef(initialTopIndex > 0);

  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
        // OverlayScrollbars resets the wrapped viewport's scrollTop to 0 as it
        // initializes (deferred), clobbering the mount-time auto-scroll and
        // stranding the list at the top. Re-apply it to the *current* nearest
        // note — read via ref since this is the mount-time closure. The first
        // rAF lets the reset settle; the second re-asserts once the freshly
        // mounted rows are measured (a lone scrollToIndex to a far, unmeasured
        // row otherwise lands short).
        const reapply = () => {
          const index = nearestIndexRef.current;
          if (index < 0) return;
          virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        };
        requestAnimationFrame(() => {
          reapply();
          requestAnimationFrame(reapply);
        });
      },
    },
  });

  useEffect(() => {
    const root = osRootRef.current;
    if (scroller && root) {
      initialize({ target: root, elements: { viewport: scroller } });
    }
    return () => osInstance()?.destroy();
  }, [scroller, initialize, osInstance]);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  // Track the parent scroll container's available height so Virtuoso has a
  // bounded viewport. Same pattern as TOCView.
  useEffect(() => {
    const updateHeight = () => {
      if (!listHostRef.current) return;
      const rect = listHostRef.current.getBoundingClientRect();
      const parentContainer = listHostRef.current.closest('.scroll-container');
      if (parentContainer) {
        const parentRect = parentContainer.getBoundingClientRect();
        const availableHeight = parentRect.height - (rect.top - parentRect.top);
        setContainerHeight(Math.max(400, availableHeight));
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (listHostRef.current) {
      const parentContainer = listHostRef.current.closest('.scroll-container');
      if (parentContainer) {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(parentContainer);
      }
    }
    return () => {
      window.removeEventListener('resize', updateHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  // When the nearest cfi changes (progress moved or notes changed), scroll
  // the virtualized list so the active note stays in view. We replace the
  // per-item useScrollToItem (which forced 1000 layout reads) with a single
  // virtuosoRef.scrollToIndex call.
  useEffect(() => {
    // While the user is filtering/searching, the list is a result set, not a
    // mirror of the reading position; jumping to the nearest note would yank
    // their scroll position on every keystroke.
    if (isFiltering) {
      // Forget the last auto-scroll target while filtering so that clearing
      // the filter re-centers on the reading position instead of being
      // skipped by the ref-equality guard below.
      lastScrolledCfiRef.current = null;
      return;
    }
    if (nearestIndex < 0) return;
    if (nearestCfi === lastScrolledCfiRef.current) return;
    lastScrolledCfiRef.current = nearestCfi;
    // initialTopMostItemIndex already centered the mount position; a
    // scrollToIndex that races Virtuoso's first render no-ops or wedges it, so
    // skip this one and let the `initialized` re-apply restore it if needed.
    if (initialScrollHandledRef.current) {
      initialScrollHandledRef.current = false;
      return;
    }
    const isEink = document.documentElement.getAttribute('data-eink') === 'true';
    // Jump instantly for far moves (and on eink, which ghosts during a smooth
    // animation) to avoid blanking the virtualized list mid-animation; keep
    // smooth only for short, in-session progress updates (mirrors TOCView). A
    // far instant jump can land short until the target rows are measured, so
    // re-assert once on the next frame.
    const distance = Math.abs(nearestIndex - visibleCenterRef.current);
    const behavior = isEink || distance > 16 ? 'auto' : 'smooth';
    virtuosoRef.current?.scrollToIndex({ index: nearestIndex, align: 'center', behavior });
    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: nearestIndex,
          align: 'center',
          behavior: 'auto',
        });
      });
    }
  }, [nearestCfi, nearestIndex, isFiltering]);

  const renderItem = useCallback(
    (index: number) => {
      const row = flatItems[index];
      if (!row) return null;
      if (row.kind === 'group-header') {
        return (
          <div className='px-2 pt-2'>
            <h3 className='content font-size-base line-clamp-1 px-2 font-normal'>
              {row.group.label}
            </h3>
          </div>
        );
      }
      return (
        <ul className='px-2'>
          <BooknoteItem
            bookKey={bookKey}
            item={row.item}
            isNearest={row.item.cfi === nearestCfi}
            onClick={handleBrowseBookNotes}
            inlineNoteEditing={type === 'annotation'}
          />
        </ul>
      );
    },
    [flatItems, bookKey, nearestCfi, handleBrowseBookNotes, type],
  );

  // Always mount the listHostRef host so the height-measurement effect (and
  // its ResizeObserver) can attach on first mount, even when starting from the
  // empty state. Otherwise transitioning empty -> populated (e.g. after
  // importing notes) would leave Virtuoso stuck at the initial 400px until a
  // remount (tab switch) occurs.
  const isEmpty = sortedGroups.length === 0;

  return (
    <div className='booknote-list rounded' role='tree'>
      {type === 'annotation' && (
        <AnnotationsToolbar
          filterKind={filterKind}
          searchInput={searchInput}
          isSearchVisible={isSearchBarVisible}
          highlightCount={counts.highlights}
          noteCount={counts.notes}
          matchCount={filteredNotes.length}
          isFiltering={isFiltering}
          onCloseSearch={() => setSearchBarVisible(false)}
          colors={facets.colors}
          styles={facets.styles}
          excludedColors={excludedColors}
          excludedStyles={excludedStyles}
          onFilterKindChange={setFilterKind}
          onSearchInputChange={setSearchInput}
          onToggleColor={toggleColor}
          onToggleStyle={toggleStyle}
          onResetFilters={resetFilters}
        />
      )}
      <div ref={listHostRef}>
        {isEmpty && isFiltering ? (
          <div
            className='flex items-center justify-center overflow-hidden'
            style={{ height: containerHeight }}
          >
            <EmptyState Icon={PiMagnifyingGlass} label={_('No Matching Annotations')} />
          </div>
        ) : isEmpty ? (
          <div
            className='flex items-center justify-center overflow-hidden'
            style={{ height: containerHeight }}
          >
            <EmptyState
              Icon={type === 'annotation' ? PiNotePencil : RiBookmark3Line}
              label={type === 'annotation' ? _('No Annotations') : _('No Bookmarks')}
              hint={type === 'annotation' ? _('Select some text to highlight') : undefined}
              action={
                type === 'bookmark' ? (
                  <button
                    type='button'
                    className='btn btn-contrast h-9 min-h-0 max-w-full flex-nowrap gap-1.5 rounded-lg px-4 text-sm font-medium'
                    onClick={() => eventDispatcher.dispatch('toggle-bookmark', { bookKey })}
                  >
                    <RiBookmarkLine className='shrink-0 text-base' />
                    <span className='min-w-0 truncate'>{_('Bookmark This Page')}</span>
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div
            ref={osRootRef}
            data-overlayscrollbars-initialize=''
            style={{ height: containerHeight }}
          >
            <Virtuoso
              ref={virtuosoRef}
              scrollerRef={handleScrollerRef}
              initialTopMostItemIndex={
                initialTopIndex > 0 ? { index: initialTopIndex, align: 'center' } : 0
              }
              rangeChanged={({ startIndex, endIndex }) => {
                visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
              }}
              style={{ height: containerHeight }}
              totalCount={flatItems.length}
              computeItemKey={(index) => flatItems[index]?.key ?? index}
              itemContent={renderItem}
              overscan={500}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default BooknoteView;
