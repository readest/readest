import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSyncContext } from '@/context/SyncContext';
import { SyncData, SyncOp, SyncResult, SyncType } from '@/libs/sync';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { transformBookConfigFromDB } from '@/utils/transform';
import { transformBookNoteFromDB } from '@/utils/transform';
import { transformBookFromDB } from '@/utils/transform';
import { DBBook, DBBookConfig, DBBookNote } from '@/types/records';
import { Book, BookConfig, BookDataRecord, BookNote } from '@/types/book';

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

const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000;

export function useSync(bookKey?: string) {
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getConfig, setConfig } = useBookDataStore();
  const config = bookKey ? getConfig(bookKey) : null;

  const [syncingBooks, setSyncingBooks] = useState(false);
  const [syncingConfigs, setSyncingConfigs] = useState(false);
  const [syncingNotes, setSyncingNotes] = useState(false);

  const [syncError, setSyncError] = useState<string | null>(null);

  const lastSyncedBooksAt = settings.lastSyncedAtBooks ?? 0;
  const lastSyncedConfigsAt = config?.lastSyncedAtConfig ?? settings.lastSyncedAtConfigs ?? 0;
  const lastSyncedNotesAt = config?.lastSyncedAtNotes ?? settings.lastSyncedAtNotes ?? 0;

  const [lastSyncedAtBooks, setLastSyncedAtBooks] = useState<number>(
    lastSyncedBooksAt > 0 ? lastSyncedBooksAt - SEVEN_DAYS_IN_MS : 0,
  );
  const [lastSyncedAtConfigs, setLastSyncedAtConfigs] = useState<number>(
    lastSyncedConfigsAt > 0 ? lastSyncedConfigsAt - SEVEN_DAYS_IN_MS : 0,
  );
  const [lastSyncedAtNotes, setLastSyncedAtNotes] = useState<number>(
    lastSyncedNotesAt > 0 ? lastSyncedNotesAt - SEVEN_DAYS_IN_MS : 0,
  );

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

  // bookId is for configs and notes only, if bookId is provided, only pull changes for that book
  // and update the lastSyncedAt for that book in the book config
  const pullChanges = async (
    type: SyncType,
    since: number,
    setLastSyncedAt: React.Dispatch<React.SetStateAction<number>>,
    setSyncing: React.Dispatch<React.SetStateAction<boolean>>,
    bookId?: string,
  ) => {
    setSyncing(true);
    setSyncError(null);

    try {
      const result = await syncClient.pullChanges(since, type, bookId);
      setSyncResult({ ...syncResult, [type]: result[type] });
      const records = result[type];
      if (!records?.length) return;
      const maxTime = computeMaxTimestamp(records);
      setLastSyncedAt(maxTime);
      switch (type) {
        case 'books':
          settings.lastSyncedAtBooks = maxTime;
          setSettings(settings);
          saveSettings(envConfig, settings);
          break;
        case 'configs':
          if (!bookId) {
            settings.lastSyncedAtConfigs = maxTime;
            setSettings(settings);
            saveSettings(envConfig, settings);
          } else if (bookKey && config) {
            config.lastSyncedAtConfig = maxTime;
            setConfig(bookKey, config);
          }
          break;
        case 'notes':
          if (!bookId) {
            settings.lastSyncedAtNotes = maxTime;
            setSettings(settings);
            saveSettings(envConfig, settings);
          } else if (bookKey && config) {
            config.lastSyncedAtNotes = maxTime;
            setConfig(bookKey, config);
          }
          break;
      }
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
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

  const syncBooks = async (books?: Book[], op: SyncOp = 'both') => {
    if ((op === 'push' || op === 'both') && books?.length) {
      await pushChanges({ books });
    }
    if (op === 'pull' || op === 'both') {
      await pullChanges('books', lastSyncedAtBooks, setLastSyncedAtBooks, setSyncingBooks);
    }
  };

  const syncConfigs = async (bookConfigs?: BookConfig[], bookId?: string, op: SyncOp = 'both') => {
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
      );
    }
  };

  const syncNotes = async (bookNotes?: BookNote[], bookId?: string, op: SyncOp = 'both') => {
    if ((op === 'push' || op === 'both') && bookNotes?.length) {
      await pushChanges({ notes: bookNotes });
    }
    if (op === 'pull' || op === 'both') {
      await pullChanges('notes', lastSyncedAtNotes, setLastSyncedAtNotes, setSyncingNotes, bookId);
    }
  };

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
    pullChanges,
    pushChanges,
    syncBooks,
    syncConfigs,
    syncNotes,
  };
}
