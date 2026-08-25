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

  // The actual disk write for this book's reading position. Guarded so the
  // initial relocate and no-op saves don't bump config.updatedAt (#4222).
  // Shared by the debounced auto-save and the on-hide flush below so both
  // apply the same guard and neither can double-write (lastSavedLocationRef
  // makes a second call with an unchanged location a no-op).
  const persistProgress = useCallback(async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Stable ref so the debounced closure and the hide listener (both created
  // once) always call the latest persist fn without being recreated.
  const persistProgressRef = useRef(persistProgress);
  persistProgressRef.current = persistProgress;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookConfig = useCallback(
    debounce(() => {
      setTimeout(() => {
        void persistProgressRef.current();
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

  // The debounced save above lands ~1.5s after the last page turn, but Android
  // freezes and kills a backgrounded WebView well inside that window (Boox
  // e-ink power management is especially aggressive, and hidden-tab timers are
  // throttled). None of the graceful-close paths (beforeunload / quit-app /
  // the book-close save) fire on sleep, HOME, or a background kill — only
  // `visibilitychange`. So persist the position the moment we lose the
  // foreground, bypassing the debounce, so the last turns survive the kill and
  // the reader doesn't reopen a few pages back (issue #5859). `pagehide`
  // covers webview teardown / reload. In-memory config is already current here:
  // FoliateViewer commits the relocate synchronously once the page is hidden.
  useEffect(() => {
    const flush = () => {
      void persistProgressRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

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
