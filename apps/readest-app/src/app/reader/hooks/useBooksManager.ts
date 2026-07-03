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

  // Jump the switched-in book to a deep-link cfi (#4887) once its view has
  // finished initing. The freshly-opened FoliateView first lands on the saved
  // reading position, so wait for `inited` and then goTo; mark it a preview so
  // the saved position is not overwritten. The subscription cleans itself up on
  // success or on load failure.
  const goToCfiWhenReady = (bookKey: string, cfi: string) => {
    const jump = () => {
      const { getView, setPreviewMode } = useReaderStore.getState();
      getView(bookKey)?.goTo(cfi);
      setPreviewMode(bookKey, true);
    };
    const ready = (state: ReturnType<typeof useReaderStore.getState>) => {
      const vs = state.viewStates[bookKey];
      return { done: !!vs?.error || (!!vs?.inited && !!vs?.view), ok: !!vs?.inited && !!vs?.view };
    };
    const initial = ready(useReaderStore.getState());
    if (initial.done) {
      if (initial.ok) jump();
      return;
    }
    const unsub = useReaderStore.subscribe((state) => {
      const { done, ok } = ready(state);
      if (!done) return;
      unsub();
      if (ok) jump();
    });
  };

  // Open a book in-place when a widget/deep link targets a book while a reader
  // is already mounted. REPLACE the open book(s) with the target one (single
  // ids=<hash>) rather than appending: appending produced ids=a+b which, with
  // the OS re-delivering the launch deep link, looped. The store update renders
  // the new book immediately; closing the previous key follows the same path as
  // dismissBook. An optional cfi (annotation deep link) is applied once ready.
  const openBookInReader = (bookHash: string, cfi?: string) => {
    const existing = bookKeys.find((key) => key.startsWith(bookHash));
    if (existing) {
      setSideBarBookKey(existing);
      if (cfi) goToCfiWhenReady(existing, cfi);
      return;
    }
    const newKey = `${bookHash}-${uniqueId()}`;
    initViewState(envConfig, bookHash, newKey, true);
    setBookKeys([newKey]);
    setSideBarBookKey(newKey);
    setShouldUpdateSearchParams(true);
    if (cfi) goToCfiWhenReady(newKey, cfi);
  };

  // Stable ref so the listener calls the latest closure without re-subscribing.
  const openBookRef = useRef(openBookInReader);
  openBookRef.current = openBookInReader;
  useEffect(() => {
    const handle = (event: CustomEvent) => {
      const { bookHash, cfi } = event.detail as { bookHash: string; cfi?: string };
      openBookRef.current(bookHash, cfi);
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
