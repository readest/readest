import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { getBookProgress, useBookProgress } from '@/store/readerProgressStore';
import { findABSServerById } from '@/store/absServerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import {
  buildAbsEbookProgressPatch,
  findAbsEbookProgress,
  resolveAbsEbookResume,
} from '@/services/audiobookshelf/ebookProgress';
import {
  readLocalLastPlayedAt,
  writeLocalLastPlayedAt,
} from '@/services/audiobookshelf/progressSync';
import { SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { isAbsEbook, parseAbsFilePath } from '@/utils/audiobook';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';

/**
 * Two-way reading-progress sync for an ebook streamed from an Audiobookshelf
 * server (issue #6257). ABS keeps one progress record per library item, and
 * its ereader stores the reading position in that record's `ebookLocation` /
 * `ebookProgress` fields — so pushing there is what makes the position visible
 * in the ABS UI and on its other clients, and reading it back is what resumes
 * a book carried over from one of them.
 *
 * Audiobooks sync the same record through a listening session instead
 * (services/audiobookshelf/progressSync.ts); this hook is for the ebook-only
 * items that never open one.
 */
export const useABSProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  // Per-field selectors: this hook's host (FoliateViewer) must not re-render on
  // every bookDataStore write. See store/readerProgressStore.ts.
  const getConfig = useBookDataStore((s) => s.getConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const progress = useBookProgress(bookKey);

  const pullStarted = useRef(false);
  const pullSettled = useRef(false);

  /** The ABS client and item id for this book, or null when it isn't an ABS ebook. */
  const getTarget = useCallback(async () => {
    const book = getBookData(bookKey)?.book;
    if (!book || !isAbsEbook(book)) return null;
    const parsed = parseAbsFilePath(book.filePath);
    if (!parsed) return null;
    const server = findABSServerById(parsed.serverId);
    if (!server || server.deletedAt) return null;
    const appService = await envConfig.getAppService();
    return { client: createAbsClient(appService, server), itemId: parsed.itemId, hash: book.hash };
  }, [bookKey, envConfig, getBookData]);

  const pushProgress = useCallback(async () => {
    // The position in memory while previewing a deep-link target is the
    // annotation's, not what the user is reading — same guard as useProgressSync.
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const position = getBookProgress(bookKey);
    const fraction = position?.fraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return;
    const target = await getTarget();
    if (!target) return;
    // Stamp before the request, not after it: the position moved here
    // whether or not the server is reachable, and an unreachable server must
    // not let its older row win the next resume.
    writeLocalLastPlayedAt(target.hash, Date.now());
    try {
      await target.client.patchProgress(
        target.itemId,
        buildAbsEbookProgressPatch({ location: position?.location, fraction }),
      );
    } catch (error) {
      // Best-effort: a server that is off, unreachable, or has since been
      // removed must not interrupt reading. The next page turn retries.
      console.warn('Failed to push reading progress to Audiobookshelf', error);
    }
  }, [bookKey, getTarget]);

  const pushProgressRef = useRef(pushProgress);
  pushProgressRef.current = pushProgress;

  // Created once: re-creating the debounced function would drop a pending push.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoPush = useCallback(
    debounce(() => {
      void pushProgressRef.current();
    }, SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  const pullProgress = useCallback(async () => {
    // Where the reader sat when the pull began, so the steps below can tell
    // whether the user read on while it was in flight. Taken before the first
    // await: resolving the server is one too, and a page turned during it must
    // not read back as "nothing moved".
    const locationAtPullStart = getBookProgress(bookKey)?.location;
    const target = await getTarget();
    if (!target) {
      pullSettled.current = true;
      return;
    }
    try {
      const me = await target.client.getMe();
      const remote = findAbsEbookProgress(me?.mediaProgress, target.itemId);
      const config = getConfig(bookKey);
      const position = getBookProgress(bookKey);
      // Reading that happened while the pull was open outranks whatever the
      // server says, even when the server row looks newer: the push that would
      // have stamped this device is still gated behind this very pull. Bail
      // out and let the release below schedule that position instead of
      // yanking the reader off the page they just turned to.
      if (position?.location !== locationAtPullStart) return;
      const resume = resolveAbsEbookResume({
        remote,
        localLocation: position?.location ?? config?.location,
        localFraction: position?.fraction,
        localLastReadAt: readLocalLastPlayedAt(target.hash),
      });
      const view = getView(bookKey);
      if (!resume || !view) return;
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
      if (resume.kind === 'location') {
        view.goTo(resume.location);
      } else {
        view.goToFraction(resume.fraction);
      }
      eventDispatcher.dispatch('hint', { bookKey, message: _('Reading Progress Synced') });
    } catch (error) {
      console.warn('Failed to pull reading progress from Audiobookshelf', error);
    } finally {
      // Releases the push gate below whatever the outcome, so an unreachable
      // server can't strand this device's own progress forever.
      pullSettled.current = true;
      // A page turned while the pull was open was refused by that gate, and a
      // ref flipping re-renders nothing, so the effect will not reconsider it.
      // Schedule it here or closing the book right now would lose the position.
      if (getBookProgress(bookKey)?.location !== locationAtPullStart) {
        handleAutoPush();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, getConfig, getTarget, getView, handleAutoPush]);

  // Pull: once, as soon as the view reports a position (i.e. the book is
  // rendered and can be moved).
  useEffect(() => {
    if (!progress || pullStarted.current) return;
    pullStarted.current = true;
    void pullProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Push: on page turn, but never before the pull has settled — otherwise the
  // position this device opened with would overwrite a newer one from another
  // device before it has even been read (the #5625 failure mode).
  useEffect(() => {
    if (!progress?.location || !pullSettled.current) return;
    handleAutoPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Flush the pending push when the book closes (ReaderContent dispatches
  // 'sync-book-progress' before teardown) or the user taps the manual Sync
  // row, so a quick close doesn't drop the last position read.
  useEffect(() => {
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      handleAutoPush.flush();
    };
    eventDispatcher.on('sync-book-progress', handleFlush);
    return () => {
      eventDispatcher.off('sync-book-progress', handleFlush);
    };
  }, [bookKey, handleAutoPush]);

  // Cancel a pending push on unmount so it can't fire after teardown.
  useEffect(() => {
    return () => handleAutoPush.cancel();
  }, [handleAutoPush]);
};
