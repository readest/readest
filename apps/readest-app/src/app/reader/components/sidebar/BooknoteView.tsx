import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import * as CFI from 'foliate-js/epubcfi.js';
import { PiNotePencil } from 'react-icons/pi';
import { RiBookmark3Line, RiBookmarkLine } from 'react-icons/ri';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findTocItemBS } from '@/services/nav';
import { findNearestCfi } from '@/utils/cfi';
import { TOCItem } from '@/libs/document';
import { BookNote, BooknoteGroup, BookNoteType } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
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
  const { setActiveBooknoteType, setBooknoteResults } = useSidebarStore();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey);
  const allNotes = config.booknotes ?? [];

  // Filter active notes of this type. useMemo so referential stability flows
  // through derived data and prevents needless recomputation when unrelated
  // config fields change (e.g. viewSettings, lastUpdated).
  const filteredNotes = useMemo(
    () => allNotes.filter((note) => note.type === type && !note.deletedAt),
    [allNotes, type],
  );

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

  const handleBrowseBookNotes = useCallback(() => {
    if (filteredNotes.length === 0) return;
    const sorted = [...filteredNotes].sort((a, b) => CFI.compare(a.cfi, b.cfi));
    setActiveBooknoteType(bookKey, type);
    setBooknoteResults(bookKey, sorted);
  }, [filteredNotes, bookKey, type, setActiveBooknoteType, setBooknoteResults]);

  // ---- Virtualization wiring (mirrors TOCView pattern) ----
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osRootRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const lastScrolledCfiRef = useRef<string | null>(null);

  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
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
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const parentContainer = containerRef.current.closest('.scroll-container');
      if (parentContainer) {
        const parentRect = parentContainer.getBoundingClientRect();
        const availableHeight = parentRect.height - (rect.top - parentRect.top);
        setContainerHeight(Math.max(400, availableHeight));
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      const parentContainer = containerRef.current.closest('.scroll-container');
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
    if (!nearestCfi || !flatItems.length) return;
    if (nearestCfi === lastScrolledCfiRef.current) return;
    const idx = flatItems.findIndex((row) => row.kind === 'note' && row.item.cfi === nearestCfi);
    if (idx < 0) return;
    const isEink = document.documentElement.getAttribute('data-eink') === 'true';
    virtuosoRef.current?.scrollToIndex({
      index: idx,
      align: 'center',
      behavior: isEink ? 'auto' : 'smooth',
    });
    lastScrolledCfiRef.current = nearestCfi;
  }, [nearestCfi, flatItems]);

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
          />
        </ul>
      );
    },
    [flatItems, bookKey, nearestCfi, handleBrowseBookNotes],
  );

  // Always mount the containerRef host so the height-measurement effect (and
  // its ResizeObserver) can attach on first mount, even when starting from the
  // empty state. Otherwise transitioning empty -> populated (e.g. after
  // importing notes) would leave Virtuoso stuck at the initial 400px until a
  // remount (tab switch) occurs.
  const isEmpty = sortedGroups.length === 0;

  return (
    <div ref={containerRef} className='booknote-list rounded pt-2' role='tree'>
      {isEmpty ? (
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
            style={{ height: containerHeight }}
            totalCount={flatItems.length}
            computeItemKey={(index) => flatItems[index]?.key ?? index}
            itemContent={renderItem}
            overscan={500}
          />
        </div>
      )}
    </div>
  );
};

export default BooknoteView;
