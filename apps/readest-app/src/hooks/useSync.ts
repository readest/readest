import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSyncContext } from '@/context/SyncContext';
import { SyncData, SyncOp, SyncResult, SyncType } from '@/libs/sync';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { transformBookConfigFromDB } from '@/utils/transform';
import { transformBookNoteFromDB } from '@/utils/transform';
import { transformBookFromDB } from '@/utils/transform';
import { DBBook, DBBookConfig, DBBookNote } from '@/types/records';
import { Book, BookConfig, BookDataRecord, BookNote } from '@/types/book';
import { navigateToLogin } from '@/utils/nav';
import { useReaderStore } from '@/store/readerStore';

const transformsFromDB = {
  books: transformBookFromDB,
  notes: transformBookNoteFromDB,
  configs: transformBookConfigFromDB,
};

const computeMaxTimestamp = (records: BookDataRecord[]): number => {
  let maxTime = 0;
  for (const rec of records) {
    if (rec.updated_at) {
      const updatedTime = new Date(rec.updated_at).getTime();
      maxTime = Math.max(maxTime, updatedTime);
    }
    if (rec.deleted_at) {
      const deletedTime = new Date(rec.deleted_at).getTime();
      maxTime = Math.max(maxTime, deletedTime);
    }
  }
  return maxTime;
};

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
export function useSync(bookKey?: string) {
  const router = useRouter();
  const { settings, setSettings } = useSettingsStore();
  const { getConfig, setConfig } = useBookDataStore();
  const { setIsSyncing } = useReaderStore();
  const config = bookKey ? getConfig(bookKey) : null;

  const [syncingBooks, setSyncingBooks] = useState(false);
  const [syncingConfigs, setSyncingConfigs] = useState(false);
  const [syncingNotes, setSyncingNotes] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAtBooks, setLastSyncedAtBooks] = useState<number>(0);
  const [lastSyncedAtConfigs, setLastSyncedAtConfigs] = useState<number>(0);
  const [lastSyncedAtNotes, setLastSyncedAtNotes] = useState<number>(0);
  const [lastSyncedAtInited, setLastSyncedAtInited] = useState(false);

  const [syncing, setSyncing] = useState(false);
  // null means unsynced, empty array means synced no changes
  const [syncResult, setSyncResult] = useState<SyncResult>({
    books: null,
    configs: null,
    notes: null,
  });
  const [syncedBooks, setSyncedBooks] = useState<Book[] | null>(null);
  const [syncedConfigs, setSyncedConfigs] = useState<BookConfig[] | null>(null);
  const [syncedNotes, setSyncedNotes] = useState<BookNote[] | null>(null);

  const { syncClient } = useSyncContext();

  useEffect(() => {
    if (!bookKey) return;
    setIsSyncing(bookKey, syncing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, syncing]);

  useEffect(() => {
    if (!settings.version) return;
    if (bookKey && !config?.location) return;
    if (lastSyncedAtInited) return;

    const lastSyncedBooksAt = settings.lastSyncedAtBooks ?? 0;
    const lastSyncedConfigsAt = config?.lastSyncedAtConfig ?? settings.lastSyncedAtConfigs ?? 0;
    const lastSyncedNotesAt = config?.lastSyncedAtNotes ?? settings.lastSyncedAtNotes ?? 0;
    const now = Date.now();
    setLastSyncedAtBooks(
      now - lastSyncedBooksAt > 3 * ONE_DAY_IN_MS ? 0 : lastSyncedBooksAt - ONE_DAY_IN_MS,
    );
    setLastSyncedAtConfigs(
      now - lastSyncedConfigsAt > 3 * ONE_DAY_IN_MS ? 0 : lastSyncedConfigsAt - ONE_DAY_IN_MS,
    );
    setLastSyncedAtNotes(
      now - lastSyncedNotesAt > 3 * ONE_DAY_IN_MS ? 0 : lastSyncedNotesAt - ONE_DAY_IN_MS,
    );
    setLastSyncedAtInited(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, settings, config]);

  // bookId is for configs and notes only, if bookId is provided, only pull changes for that book
  // and update the lastSyncedAt for that book in the book config
  const pullChanges = async (
    type: SyncType,
    since: number,
    setLastSyncedAt: React.Dispatch<React.SetStateAction<number>>,
    setSyncing: React.Dispatch<React.SetStateAction<boolean>>,
    bookId?: string,
    metaHash?: string,
  ) => {
    setSyncing(true);
    setSyncError(null);

    try {
      const result = await syncClient.pullChanges(since, type, bookId, metaHash);
      setSyncResult({ ...syncResult, [type]: result[type] });
      const records = result[type];
      if (since > 0 && !records?.length) return;
      // For since = 0, we set lastSyncedAt to now if no records returned
      const maxTime = records?.length ? computeMaxTimestamp(records) : Date.now();
      setLastSyncedAt(maxTime);

      // due to closures in React hooks the settings might be stale
      // we need to fetch the latest settings from store
      const settings = useSettingsStore.getState().settings;
      switch (type) {
        case 'books':
          settings.lastSyncedAtBooks = maxTime;
          setSettings(settings);
          break;
        case 'configs':
          if (!bookId) {
            settings.lastSyncedAtConfigs = maxTime;
            setSettings(settings);
          } else if (bookKey) {
            setConfig(bookKey, { lastSyncedAtConfig: maxTime });
          }
          break;
        case 'notes':
          if (!bookId) {
            settings.lastSyncedAtNotes = maxTime;
            setSettings(settings);
          } else if (bookKey) {
            setConfig(bookKey, { lastSyncedAtNotes: maxTime });
          }
          break;
      }
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        if (err.message.includes('Not authenticated') && settings.keepLogin) {
          settings.keepLogin = false;
          setSettings(settings);
          navigateToLogin(router);
        }
        setSyncError(err.message || `Error pulling ${type}`);
      } else {
        setSyncError(`Error pulling ${type}`);
      }
    } finally {
      setSyncing(false);
    }
  };

  const pushChanges = async (payload: SyncData) => {
    setSyncing(true);
    setSyncError(null);

    try {
      const result = await syncClient.pushChanges(payload);
      setSyncResult(result);
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        setSyncError(err.message || 'Error pushing changes');
      } else {
        setSyncError('Error pushing changes');
      }
    } finally {
      setSyncing(false);
    }
  };

  const syncBooks = useCallback(
    async (books?: Book[], op: SyncOp = 'both') => {
      if (!lastSyncedAtInited) return;
      if ((op === 'push' || op === 'both') && books?.length) {
        await pushChanges({ books });
      }
      if (op === 'pull' || op === 'both') {
        await pullChanges('books', lastSyncedAtBooks + 1, setLastSyncedAtBooks, setSyncingBooks);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastSyncedAtInited, lastSyncedAtBooks],
  );

  const syncConfigs = useCallback(
    async (bookConfigs?: BookConfig[], bookId?: string, metaHash?: string, op: SyncOp = 'both') => {
      if (!bookId && !lastSyncedAtInited) return;
      if ((op === 'push' || op === 'both') && bookConfigs?.length) {
        await pushChanges({ configs: bookConfigs });
      }
      if (op === 'pull' || op === 'both') {
        await pullChanges(
          'configs',
          lastSyncedAtConfigs,
          setLastSyncedAtConfigs,
          setSyncingConfigs,
          bookId,
          metaHash,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastSyncedAtInited, lastSyncedAtConfigs],
  );

  const syncNotes = useCallback(
    async (bookNotes?: BookNote[], bookId?: string, metaHash?: string, op: SyncOp = 'both') => {
      if (!lastSyncedAtInited) return;
      if ((op === 'push' || op === 'both') && bookNotes?.length) {
        await pushChanges({ notes: bookNotes });
      }
      if (op === 'pull' || op === 'both') {
        await pullChanges(
          'notes',
          lastSyncedAtNotes,
          setLastSyncedAtNotes,
          setSyncingNotes,
          bookId,
          metaHash,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastSyncedAtInited, lastSyncedAtNotes],
  );

  useEffect(() => {
    if (!syncing && syncResult) {
      const { books: dbBooks, configs: dbBookConfigs, notes: dbBookNotes } = syncResult;
      const books = dbBooks?.map((dbBook) =>
        transformsFromDB['books'](dbBook as unknown as DBBook),
      );
      const configs = dbBookConfigs?.map((dbBookConfig) =>
        transformsFromDB['configs'](dbBookConfig as unknown as DBBookConfig),
      );
      const notes = dbBookNotes?.map((dbBookNote) =>
        transformsFromDB['notes'](dbBookNote as unknown as DBBookNote),
      );
      if (books) setSyncedBooks(books);
      if (configs) setSyncedConfigs(configs);
      if (notes) setSyncedNotes(notes);
    }
  }, [syncResult, syncing]);

  return {
    syncing: syncingBooks || syncingConfigs || syncingNotes,
    syncError,
    syncResult,
    syncedBooks,
    syncedConfigs,
    syncedNotes,
    lastSyncedAtBooks,
    lastSyncedAtNotes,
    lastSyncedAtConfigs,
    useSyncInited: lastSyncedAtInited,
    pullChanges,
    pushChanges,
    syncBooks,
    syncConfigs,
    syncNotes,
  };
}
