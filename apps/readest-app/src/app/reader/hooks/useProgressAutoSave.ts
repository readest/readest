import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore, flushPendingLibrarySave } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { debounce } from '@/utils/debounce';

export const useProgressAutoSave = (bookKey: string) => {
  const { envConfig } = useEnv();
  const getConfig = useBookDataStore((s) => s.getConfig);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  // Reactive subscription so the effect below fires the debounced save
  // whenever this book's progress changes. Reads from readerProgressStore.
  const progress = useBookProgress(bookKey);

  // Tracks the location we last persisted (or, before the first save, the
  // location loaded from disk at book open). We skip saveConfig when the
  // in-memory location matches — saveConfig unconditionally bumps
  // config.updatedAt, and a bump on the initial relocate makes the local
  // record look newer than a fresher server-side push, so the next sync
  // overwrites the server's progress with the stale local one (issue #4222).
  const lastSavedLocationRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookConfig = useCallback(
    debounce(() => {
      setTimeout(async () => {
        // Skip while previewing a deep-link target — the user's actual
        // last-read position should not be overwritten by a transient view.
        if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
        const config = getConfig(bookKey);
        if (!config) return;
        const currentLocation = config.location ?? null;
        if (!initializedRef.current) {
          initializedRef.current = true;
          lastSavedLocationRef.current = currentLocation;
          return;
        }
        if (currentLocation === lastSavedLocationRef.current) return;
        const settings = useSettingsStore.getState().settings;
        await saveConfig(envConfig, bookKey, config, settings);
        lastSavedLocationRef.current = currentLocation;
      }, 500);
    }, 1000),
    [],
  );

  useEffect(() => {
    // Snapshot the loaded-from-disk location before any progress events fire,
    // so we don't treat the initial relocate as a user-driven change.
    if (!initializedRef.current) {
      const config = getConfig(bookKey);
      if (config) {
        initializedRef.current = true;
        lastSavedLocationRef.current = config.location ?? null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    saveBookConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, bookKey]);

  // On unmount (book closed / navigated away), flush any pending throttled
  // library.json write so the shelf reflects this session's last read
  // position next time it loads. The per-book config.json is already on
  // disk from the eager save in `saveConfig`, so this only catches the
  // library-level rollup.
  useEffect(() => {
    return () => {
      flushPendingLibrarySave().catch(() => {
        // Best-effort on teardown — failures fall through to next launch's
        // reconstruction from per-book config.json files.
      });
    };
  }, []);
};
