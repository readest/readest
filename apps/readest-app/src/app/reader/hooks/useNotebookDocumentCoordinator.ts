import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import {
  NotebookDocumentCoordinator,
  NotebookFlushResult,
  createNotebookDocumentCoordinator,
} from '@/app/reader/services/notebookDocumentCoordinator';
import { getNotebookRecoveryKey } from '@/app/reader/utils/notebookRecovery';

const coordinators = new Map<string, NotebookDocumentCoordinator>();

const getBookHash = (bookKey: string): string => bookKey.split('-')[0]!;

export const flushNotebookDocument = async (bookKey: string): Promise<NotebookFlushResult> => {
  const coordinator = coordinators.get(getBookHash(bookKey));
  return coordinator ? coordinator.flush() : 'clean';
};

export const flushAllNotebookDocuments = async (): Promise<NotebookFlushResult[]> =>
  Promise.all([...coordinators.values()].map((coordinator) => coordinator.flush()));

export const discardNotebookDocument = (bookKey: string): void => {
  const bookHash = getBookHash(bookKey);
  const coordinator = coordinators.get(bookHash);
  if (coordinator) coordinator.discard();
  else useNotebookDocumentStore.getState().discardDraft(bookHash);
};

export const useNotebookDocumentCoordinator = (bookKey: string | null) => {
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();

  useEffect(() => {
    if (!bookKey) return;
    const bookHash = getBookHash(bookKey);
    const profileId =
      user?.id ?? settings.replicaDeviceId ?? settings.kosync.deviceId ?? 'anonymous-profile';
    const recoveryKey = getNotebookRecoveryKey(profileId, bookHash);
    const coordinator = createNotebookDocumentCoordinator({
      bookHash,
      getBooknotes: () => useBookDataStore.getState().getConfig(bookKey)?.booknotes ?? [],
      getCompatibilityCfi: () => useBookDataStore.getState().getConfig(bookKey)?.location || null,
      persistBooknotes: async (booknotes) => {
        const store = useBookDataStore.getState();
        const updatedConfig = store.updateBooknotes(bookKey, booknotes);
        if (!updatedConfig) throw new Error('Book config unavailable');
        await store.saveConfig(
          envConfig,
          bookKey,
          updatedConfig,
          useSettingsStore.getState().settings,
        );
      },
      storage: typeof window === 'undefined' ? null : window.localStorage,
      recoveryKey,
    });
    coordinators.set(bookHash, coordinator);
    coordinator.start();

    const initialNotebook = useBookDataStore
      .getState()
      .getConfig(bookKey)
      ?.booknotes?.find((note) => note.id === 'notebook' && note.type === 'notebook');
    let durableSignature = initialNotebook
      ? `${initialNotebook.updatedAt}:${initialNotebook.deletedAt ?? ''}:${initialNotebook.note}`
      : '';
    const unsubscribeBookData = useBookDataStore.subscribe((state) => {
      const notebook = state
        .getConfig(bookKey)
        ?.booknotes?.find((note) => note.id === 'notebook' && note.type === 'notebook');
      const signature = notebook
        ? `${notebook.updatedAt}:${notebook.deletedAt ?? ''}:${notebook.note}`
        : '';
      if (signature === durableSignature) return;
      durableSignature = signature;
      coordinator.applyRemote(state.getConfig(bookKey)?.booknotes ?? []);
    });

    return () => {
      unsubscribeBookData();
      void coordinator.flush().finally(() => {
        coordinator.stop();
        if (coordinators.get(bookHash) === coordinator) coordinators.delete(bookHash);
      });
    };
  }, [bookKey, envConfig, settings.kosync.deviceId, settings.replicaDeviceId, user?.id]);
};
