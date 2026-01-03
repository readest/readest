import { useCallback, useMemo } from 'react';
import * as CFI from 'foliate-js/epubcfi.js';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { isCfiInLocation } from '@/utils/cfi';
import { findTocItemBS } from '@/utils/toc';
import { BookNoteType } from '@/types/book';
import { TOCItem } from '@/libs/document';

export function useBooknotesNav(bookKey: string, toc: TOCItem[]) {
  const { getView, getProgress } = useReaderStore();
  const { getConfig } = useBookDataStore();
  const {
    setSideBarVisible,
    getBooknotesNavState,
    setActiveBooknoteType,
    setBooknoteResults,
    setBooknoteIndex,
    clearBooknotesNav,
  } = useSidebarStore();

  const booknotesNavState = getBooknotesNavState(bookKey);
  const { activeBooknoteType, booknoteResults, booknoteIndex } = booknotesNavState;

  const progress = getProgress(bookKey);
  const currentLocation = progress?.location;

  // Get booknotes from config and filter by type
  const allBooknotes = useMemo(() => {
    const config = getConfig(bookKey);
    return config?.booknotes?.filter((note) => !note.deletedAt) || [];
  }, [bookKey, getConfig]);

  // Sort booknotes by CFI order
  const sortedBooknotes = useMemo(() => {
    if (!booknoteResults) return [];
    return [...booknoteResults].sort((a, b) => CFI.compare(a.cfi, b.cfi));
  }, [booknoteResults]);

  const totalResults = sortedBooknotes.length;
  const hasBooknotes = booknoteResults && totalResults > 0;
  const showBooknotesNav = hasBooknotes && activeBooknoteType !== null;

  // Get current section label
  const currentSection = useMemo(() => {
    if (!sortedBooknotes.length || booknoteIndex >= sortedBooknotes.length) return '';
    const currentNote = sortedBooknotes[booknoteIndex];
    if (!currentNote) return '';
    const tocItem = findTocItemBS(toc, currentNote.cfi);
    return tocItem?.label || '';
  }, [sortedBooknotes, booknoteIndex, toc]);

  // Find booknotes on the current page
  const currentPageResults = useMemo(() => {
    if (!sortedBooknotes.length || !currentLocation) return { firstIndex: -1, lastIndex: -1 };

    let firstIndex = -1;
    let lastIndex = -1;

    for (let i = 0; i < sortedBooknotes.length; i++) {
      const note = sortedBooknotes[i];
      if (note && isCfiInLocation(note.cfi, currentLocation)) {
        if (firstIndex === -1) firstIndex = i;
        lastIndex = i;
      }
    }
    if (firstIndex !== -1) {
      setTimeout(() => setBooknoteIndex(bookKey, firstIndex), 0);
    }

    return { firstIndex, lastIndex };
  }, [sortedBooknotes, currentLocation, bookKey, setBooknoteIndex]);

  // Navigate to a specific booknote
  const navigateToBooknote = useCallback(
    (index: number) => {
      if (!sortedBooknotes.length) return;
      if (index < 0 || index >= sortedBooknotes.length) return;

      const note = sortedBooknotes[index];
      if (note) {
        setBooknoteIndex(bookKey, index);
        getView(bookKey)?.goTo(note.cfi);
      }
    },
    [bookKey, sortedBooknotes, setBooknoteIndex, getView],
  );

  // Start navigation for a specific booknote type
  const startNavigation = useCallback(
    (type: BookNoteType) => {
      const filtered = allBooknotes.filter((note) => note.type === type);
      if (filtered.length === 0) return;

      const sorted = [...filtered].sort((a, b) => CFI.compare(a.cfi, b.cfi));
      setActiveBooknoteType(bookKey, type);
      setBooknoteResults(bookKey, sorted);
      setBooknoteIndex(bookKey, 0);

      // Navigate to first booknote
      if (sorted.length > 0) {
        getView(bookKey)?.goTo(sorted[0]!.cfi);
      }
    },
    [
      allBooknotes,
      bookKey,
      setActiveBooknoteType,
      setBooknoteResults,
      setBooknoteIndex,
      getView,
    ],
  );

  const handleShowResults = useCallback(() => {
    setSideBarVisible(true);
  }, [setSideBarVisible]);

  const handleClose = useCallback(() => {
    clearBooknotesNav(bookKey);
  }, [clearBooknotesNav, bookKey]);

  // Navigate to the previous page with booknotes
  const handlePrevious = useCallback(() => {
    const { firstIndex } = currentPageResults;

    if (firstIndex > 0) {
      navigateToBooknote(firstIndex - 1);
    } else if (firstIndex === -1 && booknoteIndex > 0) {
      navigateToBooknote(booknoteIndex - 1);
    }
  }, [currentPageResults, booknoteIndex, navigateToBooknote]);

  // Navigate to the next page with booknotes
  const handleNext = useCallback(() => {
    const { lastIndex } = currentPageResults;

    if (lastIndex >= 0 && lastIndex < totalResults - 1) {
      navigateToBooknote(lastIndex + 1);
    } else if (lastIndex === -1 && booknoteIndex < totalResults - 1) {
      navigateToBooknote(booknoteIndex + 1);
    }
  }, [currentPageResults, totalResults, booknoteIndex, navigateToBooknote]);

  // Check if there are booknotes before/after the current page
  const hasPreviousPage =
    currentPageResults.firstIndex > 0 ||
    (currentPageResults.firstIndex === -1 && booknoteIndex > 0);
  const hasNextPage =
    (currentPageResults.lastIndex >= 0 && currentPageResults.lastIndex < totalResults - 1) ||
    (currentPageResults.lastIndex === -1 && booknoteIndex < totalResults - 1);

  // Get counts for each booknote type
  const bookmarkCount = useMemo(
    () => allBooknotes.filter((n) => n.type === 'bookmark').length,
    [allBooknotes],
  );
  const annotationCount = useMemo(
    () => allBooknotes.filter((n) => n.type === 'annotation').length,
    [allBooknotes],
  );
  const excerptCount = useMemo(
    () => allBooknotes.filter((n) => n.type === 'excerpt').length,
    [allBooknotes],
  );

  return {
    activeBooknoteType,
    currentSection,
    booknoteIndex,
    totalResults,
    showBooknotesNav,
    hasPreviousPage,
    hasNextPage,
    bookmarkCount,
    annotationCount,
    excerptCount,
    startNavigation,
    handleShowResults,
    handleClose,
    handlePrevious,
    handleNext,
  };
}
