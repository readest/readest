import { useCallback, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { pullBookConfig, pushBookConfig, pushBookCover, pushBookFile } from '@/services/s3/S3Sync';
import { S3RequestError } from '@/services/s3/S3Client';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * S3 per-book sync hook.
 *
 * Mirrors the architecture of `useWebDAVSync`.
 */

/** Debounce window for auto-push triggered by progress / booknote churn. */
const PUSH_DEBOUNCE_MS = 15_000;
/** Minimum gap between automatic pulls (e.g. window-focus, open-book). */
const PULL_COOLDOWN_MS = 60_000;
/**
 * If this hook ran a successful pull less than this long ago for the
 * current book, skip the open-book pull entirely.
 */
const OPEN_PULL_SKIP_MS = 30_000;

export const useS3Sync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getProgress, getViewsById, getView } = useReaderStore();
  const { getConfig, setConfig, getBookData, saveConfig } = useBookDataStore();
  const progress = getProgress(bookKey);

  /**
   * `dirtyRef` flips to true on the first locally-driven change after a
   * successful push, and back to false right before each push fires. We
   * use it to skip no-op flushes.
   */
  const dirtyRef = useRef(false);
  /** Last successful pull timestamp; gates window-focus and open-book pulls. */
  const lastPulledAtRef = useRef(0);
  const hasPulledOnce = useRef(false);
  /**
   * Per-instance lock for the book-file uploader.
   */
  const fileSyncedRef = useRef(false);

  const ensureDeviceId = useCallback((): string => {
    const latest = useSettingsStore.getState().settings;
    let id = latest.s3?.deviceId;
    if (!id) {
      id = uuidv4();
      const next = { ...latest, s3: { ...latest.s3, deviceId: id } };
      setSettings(next);
      saveSettings(envConfig, next);
    }
    return id;
  }, [envConfig, setSettings, saveSettings]);

  const updateLastSyncedAt = useCallback(
    async (ts: number) => {
      const latest = useSettingsStore.getState().settings;
      const next = { ...latest, s3: { ...latest.s3, lastSyncedAt: ts } };
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [envConfig, setSettings, saveSettings],
  );

  const isReady = useMemo(() => {
    const s = settings.s3;
    return !!(s?.enabled && s?.accessKeyId && s?.secretAccessKey && s?.bucketName);
  }, [settings.s3]);

  const strategy = settings.s3?.strategy ?? 'silent';
  const allowPush = isReady && strategy !== 'receive';
  const allowPull = isReady && strategy !== 'send';

  /**
   * Push the latest config (progress + booknotes) to the remote.
   */
  const pushNow = useCallback(async () => {
    if (!allowPush) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const wantProgress = settings.s3?.syncProgress ?? true;
    const wantNotes = settings.s3?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    try {
      const deviceId = ensureDeviceId();
      await pushBookConfig(settings.s3!, book, config, deviceId);
      dirtyRef.current = false;
      await updateLastSyncedAt(Date.now());
    } catch (e) {
      if (e instanceof S3RequestError) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('S3 sync failed. Check your credentials in Settings.'),
        });
      } else {
        console.warn('S3 push failed', e);
      }
    }
  }, [
    allowPush,
    bookKey,
    getConfig,
    getBookData,
    ensureDeviceId,
    settings.s3,
    updateLastSyncedAt,
    _,
  ]);

  /**
   * Upload the book binary if syncBooks is on and the remote doesn't
   * already have a same-sized copy.
   */
  const pushBookFileNow = useCallback(async () => {
    if (!allowPush) return;
    if (!(settings.s3?.syncBooks ?? false)) return;
    if (fileSyncedRef.current) return;
    fileSyncedRef.current = true;

    const book = getBookData(bookKey)?.book;
    if (!book || !appService) return;

    try {
      const result = await pushBookFile(settings.s3!, book, async () => {
        const fp = book.filePath ?? getLocalBookFilename(book);
        const base = book.filePath ? 'None' : 'Books';
        if (!(await appService.exists(fp, base))) return null;
        const file = await appService.openFile(fp, base);
        const bytes = await file.arrayBuffer();
        return { bytes, size: bytes.byteLength };
      });
      if (result.uploaded) {
        await updateLastSyncedAt(Date.now());
      }
      try {
        await pushBookCover(settings.s3!, book.hash, async () => {
          const fp = getCoverFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        });
      } catch (e) {
        console.warn('S3 book cover push failed', e);
      }
    } catch (e) {
      fileSyncedRef.current = false;
      if (e instanceof S3RequestError) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('S3 sync failed. Check your credentials in Settings.'),
        });
      } else {
        console.warn('S3 book file push failed', e);
      }
    }
  }, [allowPush, settings.s3, getBookData, bookKey, appService, updateLastSyncedAt, _]);

  /**
   * Pull, merge, and persist.
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!allowPull) return false;
    const wantProgress = settings.s3?.syncProgress ?? true;
    const wantNotes = settings.s3?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return false;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return false;

    try {
      const result = await pullBookConfig(settings.s3!, book, config);
      lastPulledAtRef.current = Date.now();
      if (!result.applied || !result.mergedConfig) return false;

      if (wantNotes && result.mergedNotes) {
        const view = getView(bookKey);
        const previousById = new Map((config.booknotes ?? []).map((n) => [n.id, n]));
        for (const note of result.mergedNotes) {
          const prev = previousById.get(note.id);
          if (note.deletedAt && (!prev || !prev.deletedAt)) {
            getViewsById(bookKey.split('-')[0]!).forEach((v) => removeBookNoteOverlays(v, note));
          } else if (!note.deletedAt && note.cfi && view) {
            try {
              view.addAnnotation(note);
            } catch {
              // The annotation may not belong to the current spine index.
            }
          }
        }
      }

      const toApply = { ...result.mergedConfig };
      if (!wantProgress) {
        toApply.progress = config.progress;
        toApply.location = config.location;
        toApply.xpointer = config.xpointer;
      }
      if (!wantNotes) {
        toApply.booknotes = config.booknotes;
      }

      setConfig(bookKey, toApply);
      const latest = getConfig(bookKey);
      if (latest) await saveConfig(envConfig, bookKey, latest, settings);
      await updateLastSyncedAt(Date.now());
      return true;
    } catch (e) {
      if (e instanceof S3RequestError) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('S3 sync failed. Check your credentials in Settings.'),
        });
      } else {
        console.warn('S3 pull failed', e);
      }
      return false;
    }
  }, [
    allowPull,
    bookKey,
    getConfig,
    getBookData,
    getView,
    getViewsById,
    setConfig,
    saveConfig,
    envConfig,
    settings,
    updateLastSyncedAt,
    _,
  ]);

  const syncRefs = useRef({ pushNow, pullNow, pushBookFileNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow, pushBookFileNow };
  }, [pushNow, pullNow, pushBookFileNow]);

  const debouncedPush = useCallback(
    debounce(() => {
      if (!dirtyRef.current) return;
      syncRefs.current.pushNow();
    }, PUSH_DEBOUNCE_MS),
    [],
  );

  const markDirtyAndSchedule = useCallback(() => {
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush]);

  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    if (hasPulledOnce.current) return;
    hasPulledOnce.current = true;
    if (Date.now() - lastPulledAtRef.current < OPEN_PULL_SKIP_MS) return;
    (async () => {
      const merged = await syncRefs.current.pullNow();
      if (!merged) {
        dirtyRef.current = true;
        await syncRefs.current.pushNow();
      }
      await syncRefs.current.pushBookFileNow();
    })();
  }, [isReady, progress?.location]);

  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    markDirtyAndSchedule();
  }, [isReady, progress?.location, markDirtyAndSchedule]);

  const config = getConfig(bookKey);
  const booknoteFingerprint = useMemo(() => {
    const notes = config?.booknotes ?? [];
    let max = 0;
    for (const n of notes) {
      const t = Math.max(n.updatedAt ?? 0, n.deletedAt ?? 0);
      if (t > max) max = t;
    }
    return `${notes.length}:${max}`;
  }, [config?.booknotes]);
  useEffect(() => {
    if (!isReady) return;
    if (Date.now() - lastPulledAtRef.current < 1_000) return;
    markDirtyAndSchedule();
  }, [isReady, booknoteFingerprint, markDirtyAndSchedule]);

  useEffect(() => {
    const handlePush = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      dirtyRef.current = true;
      fileSyncedRef.current = false;
      debouncedPush.flush();
      syncRefs.current.pushBookFileNow();
    };
    const handlePull = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      lastPulledAtRef.current = 0;
      hasPulledOnce.current = false;
      syncRefs.current.pullNow();
    };
    eventDispatcher.on('push-s3-sync', handlePush);
    eventDispatcher.on('pull-s3-sync', handlePull);
    eventDispatcher.on('flush-s3-sync', handlePush);
    return () => {
      eventDispatcher.off('push-s3-sync', handlePush);
      eventDispatcher.off('pull-s3-sync', handlePull);
      eventDispatcher.off('flush-s3-sync', handlePush);
    };
  }, [bookKey, debouncedPush]);

  useWindowActiveChanged((isActive) => {
    if (!isReady) return;
    if (isActive) {
      if (Date.now() - lastPulledAtRef.current < PULL_COOLDOWN_MS) return;
      syncRefs.current.pullNow();
    } else if (dirtyRef.current) {
      debouncedPush.flush();
    }
  });

  useEffect(() => {
    return () => {
      debouncedPush.flush();
    };
  }, [debouncedPush]);

  return { pushNow, pullNow };
};

export default useS3Sync;
