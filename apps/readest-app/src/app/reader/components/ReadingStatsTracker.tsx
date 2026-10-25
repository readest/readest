'use client';

import { useEffect, useRef, useState } from 'react';
import { getBookProgress, useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { TrackerCore, type FlushedEvent } from '@/services/statistics/trackerCore';
import { getBookHashFromKey, ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';
import { SyncClient } from '@/libs/sync';
import { BookOrbitClient } from '@/services/bookorbit/BookOrbitClient';
import { pushStatsToBookOrbit } from '@/services/bookorbit/statsPush';
import { pushStats, pullStats } from '@/services/statistics/statsSync';
import { registerPageFlusher } from '@/services/statistics/pageFlush';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

const nowSec = () => Math.floor(Date.now() / 1000);

// Statistics are best-effort telemetry: a failed write or sync (e.g. the
// statistics DB torn down mid-flight on app teardown -> "database ... not
// loaded", Sentry READEST-6) must never surface as an unhandled rejection.
const runBestEffort = (work: Promise<unknown>): void => {
  void work.catch((err) => console.warn('[stats] background operation failed:', err));
};

export default function ReadingStatsTracker({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  // Progress lives in readerProgressStore, not readerStore.viewStates.
  const progress = useBookProgress(bookKey);
  // booksData is keyed by book id = bookKey.split('-')[0].
  const getBookData = useBookDataStore((s) => s.getBookData);
  const { user } = useAuth();
  const coreRef = useRef(new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG));
  // Page marker already written so a new book appears in the stats at once.
  const markedRef = useRef<string | null>(null);
  const dbRef = useRef<StatisticsDb | null>(null);
  // Flips once the statistics DB is open, so the opening page can be marked
  // even though the tracker mounts before StatisticsDb.open resolves.
  const [dbReady, setDbReady] = useState(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While this book is being read aloud, TtsStatsRecorder owns the clock and
  // this tracker stands down — otherwise TTS auto-follow's relocations would
  // bill the same wall-clock a second time. Seeded from the manager rather than
  // the event bus alone, so opening the reader from the mini player mid-session
  // doesn't miss the transition that already happened.
  const ttsPlayingRef = useRef(
    ttsSessionManager.getPlaybackState() === 'playing' &&
      ttsSessionManager.getActiveSession()?.bookHash === getBookHashFromKey(bookKey),
  );

  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  // Book.hash is the partialMD5 used as KOReader's md5.
  const bookMd5 = book?.hash;
  const title = book?.title ?? '';
  // Book.author is the single-string author field; upsertBook takes authors: string.
  const authors = book?.author ?? '';

  const syncEnabled = () => !!user && isSyncCategoryEnabled('stats');

  // BookOrbit stats push needs no Readest account — only the integration.
  const bookOrbitStatsPush = (db: StatisticsDb): Promise<unknown> | undefined => {
    const { settings } = useSettingsStore.getState();
    const bookorbit = settings.bookorbit;
    if (
      !bookorbit.enabled ||
      !bookorbit.syncStats ||
      !bookorbit.serverUrl ||
      !bookorbit.username ||
      !bookorbit.userkey
    ) {
      return undefined;
    }
    return pushStatsToBookOrbit(db, new BookOrbitClient(bookorbit));
  };

  const pushToAllTargets = (db: StatisticsDb) => {
    if (syncEnabled()) runBestEffort(pushStats(db, new SyncClient()));
    const bookOrbitPush = bookOrbitStatsPush(db);
    if (bookOrbitPush) runBestEffort(bookOrbitPush);
  };

  const schedulePush = () => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      const db = dbRef.current;
      if (db) pushToAllTargets(db);
    }, 10_000);
  };

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    runBestEffort(
      StatisticsDb.open(appService).then((db) => {
        if (cancelled) return;
        dbRef.current = db;
        setDbReady(true);
        if (syncEnabled()) runBestEffort(pullStats(db, new SyncClient()));
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  // Persist flushed events into the statistics DB.
  const persist = async (events: FlushedEvent[]): Promise<void> => {
    const db = dbRef.current;
    if (!db || !bookMd5 || events.length === 0) return;
    try {
      const idBook = await db.upsertBook({ bookMd5, title, authors });
      for (const e of events) await db.insertPageEvent(idBook, e);
      await db.recomputeBookTotals(idBook);
      schedulePush();
    } catch (err) {
      // The statistics DB can be closed mid-write on app/tab teardown
      // ("database ... not loaded", Sentry READEST-6). Best-effort: log and
      // never reject, so the fire-and-forget dispatch sites stay safe.
      console.warn('[stats] failed to persist reading events:', err);
    }
  };

  const armIdle = () => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(
      () => void persist(coreRef.current.onIdle(nowSec())),
      DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000,
    );
  };

  const openPageAt = (info: { current?: number; total: number } | undefined) => {
    if (!info) return;
    const page = (info.current ?? 0) + 1;
    const total = info.total || 1;
    const flushed = coreRef.current.onPage(page, total, nowSec());
    // Pre-insert the page being timed with 0s while its dwell is still open:
    // a freshly imported/opened book shows up in the statistics immediately,
    // and the flush later fills the real duration into the same row.
    const pending = bookMd5 && dbRef.current ? coreRef.current.currentEvent : null;
    const key = pending ? `${pending.page}:${pending.startTime}` : null;
    const marker = pending && key !== markedRef.current ? pending : null;
    if (marker) markedRef.current = key;
    void persist(marker ? [...flushed, marker] : flushed);
    armIdle();
  };

  // Page changes drive the tracker. Re-run when the book or the DB arrives so
  // the opening page gets its marker even if either was late.
  useEffect(() => {
    if (ttsPlayingRef.current) return;
    openPageAt(progress?.pageinfo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.pageinfo, bookMd5, dbReady]);

  // Let the statistics dialog flush the page currently on screen before it
  // queries, so an open book is shown with the time read so far, not just its
  // zero-duration opening marker.
  useEffect(() => {
    return registerPageFlusher(async () => {
      if (!dbRef.current || !bookMd5) return;
      const flushed = coreRef.current.onIdle(nowSec());
      await persist(flushed);
      const info = getBookProgress(bookKey)?.pageinfo;
      if (info) openPageAt(info);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, bookMd5]);

  // Hand the clock to TtsStatsRecorder while this book is read aloud, and take
  // it back afterwards. TTS turns pages to follow the narration, so without
  // this the same minutes would be recorded by both.
  useEffect(() => {
    const bookHash = getBookHashFromKey(bookKey);
    const onPlaybackState = (event: Event) => {
      const detail = (event as CustomEvent).detail as { bookKey?: string; state?: string };
      // Another book can be playing while this one is read manually.
      if (!detail?.bookKey || getBookHashFromKey(detail.bookKey) !== bookHash) return;
      const playing = detail.state === 'playing';
      if (playing === ttsPlayingRef.current) return;
      ttsPlayingRef.current = playing;
      if (playing) {
        if (idleRef.current) clearTimeout(idleRef.current);
        void persist(coreRef.current.onIdle(nowSec()));
      } else {
        openPageAt(getBookProgress(bookKey)?.pageinfo);
      }
    };
    eventDispatcher.on('tts-playback-state', onPlaybackState);
    return () => eventDispatcher.off('tts-playback-state', onPlaybackState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Tab/window visibility.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (idleRef.current) clearTimeout(idleRef.current);
        void persist(coreRef.current.onHide(nowSec()));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  // Book close (unmount).
  useEffect(() => {
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      runBestEffort(
        persist(coreRef.current.onClose(nowSec())).then(() => {
          if (dbRef.current) pushToAllTargets(dbRef.current);
          return undefined;
        }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  return null;
}
