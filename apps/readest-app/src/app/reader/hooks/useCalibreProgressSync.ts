import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { findCalibreServerById } from '@/store/calibreServerStore';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import type { CalibreClient } from '@/services/calibre/client';
import type { CalibrePosition } from '@/types/calibre';
import type { CalibreServer } from '@/types/calibre';

// Positions only need page-turn granularity; keeps a scroll session from
// hammering the server with one POST per relocate.
const CALIBRE_PUSH_DEBOUNCE_MS = 10000;

/**
 * Bidirectional reading-position sync with the book's Calibre content server
 * (calibre's per-user last-read-position API). Only books carrying
 * `metadata.calibreSource` participate — i.e. books synced from a configured
 * Calibre server.
 *
 * Pull happens once per open (the first relocate signals the view is ready),
 * applying the server position only when its epoch beats the local config's —
 * same newest-wins rule useProgressSync applies to Readest Cloud. Push is a
 * debounced silent auto-push keyed on `progress.location`, flushed on book
 * close and the reader's manual Sync button. Mirrors useKOSync's shape.
 */
export const useCalibreProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const progress = useBookProgress(bookKey);
  const hasPulledOnce = useRef(false);

  const resolveContext = useCallback(() => {
    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    const source = book?.metadata?.calibreSource;
    if (!book || !source) return null;
    const server = findCalibreServerById(source.serverId);
    if (!server || server.deletedAt || server.disabled) return null;
    // Reading positions are an official-calibre-server API; Calibre-Web has
    // none (its OPDS/Kobo surfaces don't help here).
    if (server.flavor === 'calibre-web') return null;
    return { book, source, server };
  }, [bookKey, getBookData]);

  /**
   * The client module is imported lazily on first use, not at hook mount:
   * it drags in the OPDS request utils, whose module scope resolves the
   * proxy base URL — and FoliateViewer renders inside tests that mock
   * `@/services/constants` narrowly enough to break that import (this hook
   * runs for every book, the overwhelming majority of which have no
   * calibreSource and must never touch the network stack).
   */
  const getClient = useCallback(async (server: CalibreServer): Promise<CalibreClient> => {
    const { createCalibreClient } = await import('@/services/calibre/client');
    return createCalibreClient(server);
  }, []);

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        if (!appService || !hasPulledOnce.current) return;
        const ctx = resolveContext();
        if (!ctx) return;
        // Skip pushes while previewing a deep-link target: the preview location
        // is not a reading position (same guard useProgressSync applies).
        if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
        const record = getProgress(bookKey);
        const cfi = record?.location;
        if (!cfi) return;
        const posFrac = record?.fraction ?? 0;
        try {
          const client = await getClient(ctx.server);
          await client.setLastReadPosition(
            ctx.source.libraryId,
            ctx.source.bookId,
            ctx.source.format,
            {
              device: 'readest',
              cfi,
              pos_frac: posFrac,
            },
          );
        } catch (error) {
          // Silent by design: a page-turn push failing (offline, server down)
          // must not toast over the reading experience.
          console.warn('[Calibre] failed to push reading position:', error);
        }
      }, CALIBRE_PUSH_DEBOUNCE_MS),
    [appService, bookKey, getClient, getProgress, resolveContext],
  );

  const pullProgress = useCallback(async () => {
    if (!appService || hasPulledOnce.current) return;
    // Resolve the context before consuming the single pull attempt: a null
    // context (book data or server row not loaded yet) must leave the pull
    // available for the next page-turn effect run, and keep pushes gated
    // (pushProgress also bails on a null context) so a stale local position
    // can't overwrite the newer server position. Still set before any await
    // so an in-flight pull can't race one.
    const ctx = resolveContext();
    if (!ctx) return;
    hasPulledOnce.current = true;

    try {
      // Wire form is `bookId-fmt` (pairs joined by `_`); the response is
      // keyed `"<bookId>:<fmt>"` (srv/books.py).
      const client = await getClient(ctx.server);
      const which = `${ctx.source.bookId}-${ctx.source.format}`;
      const positions = await client.getLastReadPosition(ctx.source.libraryId, [which]);
      const list: CalibrePosition[] | undefined =
        positions[`${ctx.source.bookId}:${ctx.source.format}`];
      const latest = list?.slice().sort((a, b) => (b.epoch ?? 0) - (a.epoch ?? 0))[0];
      if (!latest || !latest.cfi) return;

      const bookData = getBookData(bookKey);
      const localTimestamp = bookData?.config?.updatedAt || ctx.book.updatedAt || 0;
      if ((latest.epoch ?? 0) * 1000 <= localTimestamp) return;

      // The open was a deep link (?cfi= search-result jump): the view is
      // previewing that target and the user hasn't read yet — don't yank them
      // to the server position (same guard useProgressSync applies to its
      // own pulled location).
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;

      const view = getView(bookKey);
      if (!view) return;
      try {
        view.goTo(latest.cfi);
      } catch {
        // A CFI minted by a different reader (or format mismatch) may not
        // resolve; the fraction is the coarse but portable fallback.
        if (typeof latest.pos_frac === 'number' && latest.pos_frac > 0) {
          view.goToFraction(latest.pos_frac);
        }
      }
      eventDispatcher.dispatch('hint', {
        bookKey,
        message: _('Reading Progress Synced'),
      });
    } catch (error) {
      console.warn('[Calibre] failed to pull reading position:', error);
    }
  }, [appService, bookKey, getBookData, getClient, getView, resolveContext, _]);

  // Pull once the view reports its first location.
  useEffect(() => {
    if (!progress?.location) return;
    void pullProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Auto-push on page turns / scroll snaps.
  useEffect(() => {
    if (!progress?.location) return;
    pushProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Flush on book close (ReaderContent dispatches 'sync-book-progress' before
  // teardown) and on the manual Sync button; cancel on unmount.
  useEffect(() => {
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pushProgress.flush();
    };
    eventDispatcher.on('sync-book-progress', handleFlush);
    return () => {
      eventDispatcher.off('sync-book-progress', handleFlush);
      pushProgress.cancel();
    };
  }, [bookKey, pushProgress]);

  return { pushProgress };
};
