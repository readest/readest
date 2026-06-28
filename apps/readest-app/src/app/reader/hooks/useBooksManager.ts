import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { uniqueId } from '@/utils/misc';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';

const useBooksManager = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { bookKeys } = useReaderStore();
  const { setBookKeys, initViewState } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const [shouldUpdateSearchParams, setShouldUpdateSearchParams] = useState(false);
  const { setParallel } = useParallelViewStore();

  useEffect(() => {
    if (shouldUpdateSearchParams) {
      const ids = bookKeys.map((key) => key.split('-')[0]!);
      if (ids.length > 0) {
        navigateToReader(router, ids, searchParams?.toString() || '', { scroll: false });
      }
      setShouldUpdateSearchParams(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys, shouldUpdateSearchParams]);

  // Append a new book and sync with bookKeys and URL
  const appendBook = (id: string, isPrimary: boolean, isParallel: boolean) => {
    const newKey = `${id}-${uniqueId()}`;
    initViewState(envConfig, id, newKey, isPrimary);
    if (!bookKeys.includes(newKey)) {
      const updatedKeys = [...bookKeys, newKey];
      setBookKeys(updatedKeys);
    }
    if (isParallel) setParallel([sideBarBookKey!, newKey]);
    setSideBarBookKey(newKey);
    setShouldUpdateSearchParams(true);
  };

  // Open a book in-place when the widget taps a book while a reader is already
  // mounted. REPLACE the open book(s) with the tapped one (single ids=<hash>)
  // rather than appending: appending produced ids=a+b which, with the OS
  // re-delivering the launch deep link, looped. The store update renders the
  // new book immediately; closing the previous key follows the same path as
  // dismissBook.
  const openBookInReader = (bookHash: string) => {
    const existing = bookKeys.find((key) => key.startsWith(bookHash));
    if (existing) {
      setSideBarBookKey(existing);
      return;
    }
    const newKey = `${bookHash}-${uniqueId()}`;
    initViewState(envConfig, bookHash, newKey, true);
    setBookKeys([newKey]);
    setSideBarBookKey(newKey);
    setShouldUpdateSearchParams(true);
  };

  // Stable ref so the listener calls the latest closure without re-subscribing.
  const openBookRef = useRef(openBookInReader);
  openBookRef.current = openBookInReader;
  useEffect(() => {
    const handle = (event: CustomEvent) => {
      const { bookHash } = event.detail as { bookHash: string };
      openBookRef.current(bookHash);
    };
    eventDispatcher.on('open-book-in-reader', handle);
    return () => eventDispatcher.off('open-book-in-reader', handle);
  }, []);

  // Close a book and sync with bookKeys and URL
  const dismissBook = (bookKey: string) => {
    const updatedKeys = bookKeys.filter((key) => key !== bookKey);
    setBookKeys(updatedKeys);
    setShouldUpdateSearchParams(true);
  };

  const getNextBookKey = (bookKey: string) => {
    const index = bookKeys.indexOf(bookKey);
    const nextIndex = (index + 1) % bookKeys.length;
    return bookKeys[nextIndex]!;
  };

  const openParallelView = (id: string) => {
    const sideBarBookId = sideBarBookKey?.split('-')[0];
    appendBook(id, sideBarBookId != id, true);
  };

  return {
    bookKeys,
    appendBook,
    dismissBook,
    getNextBookKey,
    openParallelView,
  };
};

export default useBooksManager;
