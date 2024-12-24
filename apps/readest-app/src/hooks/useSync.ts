import { useEffect, useState } from 'react';
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

export function useSync(bookKey?: string) {
  const { settings } = useSettingsStore();
  const { getConfig } = useBookDataStore();

  const config = bookKey ? getConfig(bookKey) : null;

  const [syncingBooks, setSyncingBooks] = useState(false);
  const [syncingConfigs, setSyncingConfigs] = useState(false);
  const [syncingNotes, setSyncingNotes] = useState(false);

  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAtBooks, setLastSyncedAtBooks] = useState<number>(
    settings.lastSyncedAtBooks ?? 0,
  );
  const [lastSyncedAtConfigs, setLastSyncedAtConfigs] = useState<number>(
    config?.lastSyncedAtConfig ?? settings.lastSyncedAtConfigs ?? 0,
  );
  const [lastSyncedAtNotes, setLastSyncedAtNotes] = useState<number>(
    config?.lastSyncedAtNotes ?? settings.lastSyncedAtNotes ?? 0,
  );

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult>({
    books: [],
    configs: [],
    notes: [],
  });
  const [syncedBooks, setSyncedBooks] = useState<Book[]>([]);
  const [syncedConfigs, setSyncedConfigs] = useState<BookConfig[]>([]);
  const [syncedNotes, setSyncedNotes] = useState<BookNote[]>([]);

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
      const maxTime = computeMaxTimestamp(result[type]);
      setLastSyncedAt(maxTime);
      switch (type) {
        case 'books':
          settings.lastSyncedAtBooks = maxTime;
          break;
        case 'configs':
          if (!bookId) {
            settings.lastSyncedAtConfigs = maxTime;
          } else if (config) {
            config.lastSyncedAtConfig = maxTime;
          }
          break;
        case 'notes':
          if (!bookId) {
            settings.lastSyncedAtNotes = maxTime;
          } else if (config) {
            config.lastSyncedAtNotes = maxTime;
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
      const books = dbBooks.map((dbBook) => transformsFromDB['books'](dbBook as unknown as DBBook));
      const configs = dbBookConfigs.map((dbBookConfig) =>
        transformsFromDB['configs'](dbBookConfig as unknown as DBBookConfig),
      );
      const notes = dbBookNotes.map((dbBookNote) =>
        transformsFromDB['notes'](dbBookNote as unknown as DBBookNote),
      );
      if (books.length) setSyncedBooks(books);
      if (configs.length) setSyncedConfigs(configs);
      if (notes.length) setSyncedNotes(notes);
    }
  }, [syncResult, syncing]);

  return {
    syncing: syncingBooks || syncingConfigs || syncingNotes,
    syncError,
    syncResult,
    syncedBooks,
    syncedConfigs,
    syncedNotes,
    pullChanges,
    pushChanges,
    syncBooks,
    syncConfigs,
    syncNotes,
  };
}
