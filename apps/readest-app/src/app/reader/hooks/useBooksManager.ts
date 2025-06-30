import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { uniqueId } from '@/utils/misc';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { navigateToReader } from '@/utils/nav';

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
      if (ids) {
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

  // Close a book and sync with bookKeys and URL
  const dismissBook = (bookKey: string) => {
    const updatedKeys = bookKeys.filter((key) => key !== bookKey);
    setBookKeys(updatedKeys);
    setShouldUpdateSearchParams(true);
  };

  const getNextBookKey = (bookKey: string) => {
    const index = bookKeys.findIndex((key) => key === bookKey);
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
