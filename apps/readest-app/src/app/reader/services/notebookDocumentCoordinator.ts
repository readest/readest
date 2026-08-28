import { BookNote } from '@/types/book';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import {
  NOTEBOOK_ID,
  findNotebookRecord,
  upsertNotebookRecord,
} from '@/app/reader/utils/notebookDocument';
import {
  clearNotebookRecovery,
  createNotebookRecoveryEntry,
  readNotebookRecovery,
  resolveNotebookRecovery,
  writeNotebookRecovery,
} from '@/app/reader/utils/notebookRecovery';

const NOTEBOOK_SAVE_DEBOUNCE_MS = 750;

export type NotebookFlushResult = 'clean' | 'saved' | 'failed' | 'waiting-for-position';

interface NotebookDocumentCoordinatorOptions {
  bookHash: string;
  getBooknotes: () => BookNote[];
  getCompatibilityCfi: () => string | null;
  persistBooknotes: (booknotes: BookNote[]) => Promise<void>;
  storage: Storage | null;
  recoveryKey: string;
  now?: () => number;
}

export interface NotebookDocumentCoordinator {
  start: () => void;
  stop: () => void;
  flush: () => Promise<NotebookFlushResult>;
  discard: () => void;
  applyRemote: (booknotes: BookNote[]) => void;
}

export const canTransitionWithNotebookRecovery = (bookHash: string): boolean => {
  const session = useNotebookDocumentStore.getState().sessions[bookHash];
  if (!session || session.revision <= session.savedRevision) return true;
  return session.recoveryAvailable;
};

const getDurableNotebook = (
  booknotes: BookNote[],
): { content: string; updatedAt: number | null } => {
  const live = findNotebookRecord(booknotes);
  if (live) return { content: live.note, updatedAt: live.updatedAt };
  const tombstone = booknotes.find(
    (booknote) => booknote.id === NOTEBOOK_ID && booknote.type === 'notebook',
  );
  return {
    content: '',
    updatedAt: tombstone ? (tombstone.deletedAt ?? tombstone.updatedAt) : null,
  };
};

export const createNotebookDocumentCoordinator = ({
  bookHash,
  getBooknotes,
  getCompatibilityCfi,
  persistBooknotes,
  storage,
  recoveryKey,
  now = Date.now,
}: NotebookDocumentCoordinatorOptions): NotebookDocumentCoordinator => {
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<NotebookFlushResult> | null = null;

  const clearTimer = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const writeRecovery = () => {
    const session = useNotebookDocumentStore.getState().sessions[bookHash];
    if (!session || session.revision <= session.savedRevision) return true;
    if (!storage) {
      useNotebookDocumentStore.getState().markRecoveryAvailable(bookHash, false);
      return false;
    }
    const entry = createNotebookRecoveryEntry({
      content: session.content,
      baseContent: session.durableContent,
      baseUpdatedAt: session.durableUpdatedAt,
      revision: session.revision,
    });
    const available = writeNotebookRecovery(storage, recoveryKey, entry);
    useNotebookDocumentStore.getState().markRecoveryAvailable(bookHash, available);
    return available;
  };

  const scheduleSave = () => {
    clearTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, NOTEBOOK_SAVE_DEBOUNCE_MS);
  };

  const flushLoop = async (): Promise<NotebookFlushResult> => {
    clearTimer();
    let saved = false;
    while (true) {
      const session = useNotebookDocumentStore.getState().sessions[bookHash];
      if (!session || session.revision <= session.savedRevision) {
        return saved ? 'saved' : 'clean';
      }

      const revision = session.revision;
      const update = upsertNotebookRecord(
        getBooknotes(),
        session.content,
        getCompatibilityCfi(),
        now(),
        session.hasEdited,
      );
      if (!update) {
        useNotebookDocumentStore.getState().markSaveFailed(bookHash, true);
        return 'waiting-for-position';
      }

      useNotebookDocumentStore.getState().markSaving(bookHash, revision);
      try {
        await persistBooknotes(update.booknotes);
      } catch {
        useNotebookDocumentStore.getState().markSaveFailed(bookHash);
        return 'failed';
      }

      saved = true;
      useNotebookDocumentStore
        .getState()
        .markSaved(bookHash, revision, update.notebook.note, update.notebook.updatedAt);
      const latest = useNotebookDocumentStore.getState().sessions[bookHash];
      if (latest?.revision === revision) {
        if (storage) clearNotebookRecovery(storage, recoveryKey);
      } else {
        writeRecovery();
      }
    }
  };

  const flush = (): Promise<NotebookFlushResult> => {
    if (flushPromise) return flushPromise;
    const pending = flushLoop();
    flushPromise = pending;
    void pending.finally(() => {
      if (flushPromise === pending) flushPromise = null;
    });
    return pending;
  };

  const start = () => {
    if (started) return;
    started = true;
    const durable = getDurableNotebook(getBooknotes());
    const recovery = storage ? readNotebookRecovery(storage, recoveryKey) : null;
    let restored = false;
    if (recovery) {
      const resolution = resolveNotebookRecovery(durable.content, durable.updatedAt, recovery);
      if (resolution.kind === 'restore') {
        useNotebookDocumentStore.getState().hydrate(bookHash, durable.content, durable.updatedAt);
        useNotebookDocumentStore.getState().mutate(bookHash, resolution.content);
        restored = true;
      } else if (resolution.kind === 'diverged') {
        useNotebookDocumentStore
          .getState()
          .hydrate(bookHash, durable.content, durable.updatedAt, resolution.recoveryContent);
      } else {
        useNotebookDocumentStore.getState().hydrate(bookHash, durable.content, durable.updatedAt);
        if (storage) clearNotebookRecovery(storage, recoveryKey);
      }
    } else {
      useNotebookDocumentStore.getState().hydrate(bookHash, durable.content, durable.updatedAt);
    }

    unsubscribe = useNotebookDocumentStore.subscribe((state, previousState) => {
      const session = state.sessions[bookHash];
      const previous = previousState.sessions[bookHash];
      if (!session || session.revision === previous?.revision) return;
      writeRecovery();
      scheduleSave();
    });
    if (restored) {
      writeRecovery();
      scheduleSave();
    }
  };

  const stop = () => {
    started = false;
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
  };

  const applyRemote = (booknotes: BookNote[]) => {
    const durable = getDurableNotebook(booknotes);
    useNotebookDocumentStore.getState().applyRemote(bookHash, durable.content, durable.updatedAt);
  };

  const discard = () => {
    clearTimer();
    useNotebookDocumentStore.getState().discardDraft(bookHash);
    if (storage) clearNotebookRecovery(storage, recoveryKey);
  };

  return { start, stop, flush, discard, applyRemote };
};
