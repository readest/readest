import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { getBookProgress, useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { mergeProofreadRules } from '@/utils/proofread';
import { resolveReferencePageCount } from '@/utils/progress';
import { serializeConfig } from '@/utils/serializer';
import { CFI } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';
import { isMalformedLocationCfi } from '@/utils/cfi';

// Backoff schedule for the first-pull retry on book open. After these
// attempts the gate releases unconditionally so the user's progress can
// still sync out even if the server keeps timing out (high Android network
// concurrency, captive portal, transient 5xx). Total window ≈ 15.5s.
const PULL_RETRY_DELAYS_MS = [1500, 4000, 10000];

// `[current, total]` 1-based page numbers -> a 0..1 reading fraction, or
// `undefined` when the record carries no usable page count.
const getConfigFraction = (config: BookConfig): number | undefined => {
  const [current, total] = config.progress ?? [];
  if (!current || !total || total <= 0) return undefined;
  const fraction = current / total;
  return Number.isFinite(fraction) ? Math.min(fraction, 1) : undefined;
};

// A sibling copy's reading fraction must beat the local position by this margin
// before we jump to it, so re-pagination jitter between re-packaged copies of
// the same book (same metaHash, different book_hash) doesn't ping-pong the
// reader on every open (#5859).
const SIBLING_FORWARD_EPSILON = 0.002;

export const useProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  // Per-field selectors avoid subscribing this hook's host (FoliateViewer)
  // to the WHOLE bookDataStore — saveConfig writes booksData on every
  // throttled save and would otherwise re-render the entire reader subtree.
  const getConfig = useBookDataStore((s) => s.getConfig);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setViewSettings = useReaderStore((s) => s.setViewSettings);
  const recreateViewer = useReaderStore((s) => s.recreateViewer);
  const setHoveredBookKey = useReaderStore((s) => s.setHoveredBookKey);
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync(bookKey);
  const { user } = useAuth();
  // Reactive subscription on this book's progress so the effects below
  // (auto-push debounce, initial pull) re-run when the user turns the
  // page. Reads from readerProgressStore, not readerStore — see
  // store/readerProgressStore.ts for why this split exists.
  const progress = useBookProgress(bookKey);

  const configPulled = useRef(false);
  const hasPulledConfigOnce = useRef(false);
  const pullAttempt = useRef(0);
  const pullInFlight = useRef(false);
  const pullRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingPullRetry = () => {
    if (pullRetryTimer.current !== null) {
      clearTimeout(pullRetryTimer.current);
      pullRetryTimer.current = null;
    }
  };

  const pushConfig = async (bookKey: string, config: BookConfig | null) => {
    const book = getBookData(bookKey)?.book;
    if (!config || !book || !user) return;
    const bookHash = book.hash;
    const metaHash = book.metaHash;
    const newConfig = { ...config, bookHash, metaHash };
    const compressedConfig = JSON.parse(
      serializeConfig(newConfig, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG),
    );
    delete compressedConfig.booknotes;
    delete compressedConfig.audiobook;
    // The /api/sync POST handler piggybacks books.progress + books.updated_at
    // off this configs push (saves the separate syncBooks round-trip that
    // used to keep the library record fresh while a reader stayed open —
    // see issue #4198). useBooksSync still seeds new books rows when the
    // user is on the library page.
    await syncConfigs([compressedConfig], bookHash, metaHash, 'push');
  };

  const pullConfig = async (bookKey: string) => {
    const book = getBookData(bookKey)?.book;
    if (!user || !book) return;
    const bookHash = bookKey.split('-')[0]!;
    const metaHash = book.metaHash;
    await syncConfigs([], bookHash, metaHash, 'pull');
  };

  // Drives the pull on book open. A successful pull is signalled by the
  // [syncedConfigs] effect below flipping `configPulled.current` to true and
  // clearing the retry state — so this function just kicks off the next
  // pull and (re)schedules a retry. If the gate is still closed after
  // PULL_RETRY_DELAYS_MS is exhausted, release it unconditionally so the
  // user's auto-push isn't blocked by a server outage. Re-entry while a
  // pull is in flight or a retry timer is pending is a no-op.
  const pullWithRetry = useCallback(async () => {
    if (configPulled.current) return;
    if (pullInFlight.current) return;
    if (pullRetryTimer.current !== null) return;
    pullInFlight.current = true;
    try {
      await pullConfig(bookKey);
    } finally {
      pullInFlight.current = false;
    }
    if (configPulled.current) return;
    if (pullAttempt.current >= PULL_RETRY_DELAYS_MS.length) {
      // Best-effort release. The server-side last-writer-wins compare still
      // protects the cross-device case (a stale local push with an older
      // updated_at will lose to a fresher server record).
      configPulled.current = true;
      return;
    }
    const delay = PULL_RETRY_DELAYS_MS[pullAttempt.current]!;
    pullAttempt.current += 1;
    pullRetryTimer.current = setTimeout(() => {
      pullRetryTimer.current = null;
      if (!configPulled.current) pullWithRetry();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  const syncConfig = async () => {
    if (!configPulled.current) {
      pullWithRetry();
    } else {
      // Skip pushes while previewing a deep-link target — the position in
      // memory reflects the annotation, not what the user is actually reading.
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
      const config = getConfig(bookKey);
      const view = getView(bookKey);
      const book = getBookData(bookKey)?.book;
      if (config && view && book && config.progress && config.progress[0] > 0) {
        try {
          const contents = view.renderer.getContents();
          const primaryIndex = view.renderer.primaryIndex;
          const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
          if (content && !FIXED_LAYOUT_FORMATS.has(book.format)) {
            const { doc, index } = content;
            const xpointerResult = await getXPointerFromCFI(config.location!, doc, index || 0);
            config.xpointer = xpointerResult.xpointer;
          }
        } catch (error) {
          console.warn('Failed to convert CFI to XPointer', error);
        }
        pushConfig(bookKey, config);
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    debounce(() => {
      syncConfig();
    }, SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  const handleSyncBookProgress = async (event: CustomEvent) => {
    const { bookKey: syncBookKey } = event.detail;
    if (syncBookKey === bookKey) {
      // Flush any pending debounced push first so the latest local progress
      // reaches the cloud before we (re)pull. This covers the book-close case
      // (issue #4532): the reader can tear down inside the SYNC_PROGRESS_INTERVAL_SEC
      // auto-sync window, which would otherwise drop the pending push and leave
      // other devices on the previous cloud-synced position. Must run while the
      // gate below is still open so syncConfig takes the push branch.
      handleAutoSync.flush();
      // Manual pull-to-refresh: tear down any prior retry chain so the new
      // attempt starts fresh, rather than being short-circuited by the
      // "retry already pending" guard in pullWithRetry.
      configPulled.current = false;
      pullAttempt.current = 0;
      clearPendingPullRetry();
      await pullWithRetry();
    }
  };

  // Push: flush the pending push + pull when the book is closed or the user
  // taps the manual Sync button.
  useEffect(() => {
    eventDispatcher.on('sync-book-progress', handleSyncBookProgress);
    return () => {
      eventDispatcher.off('sync-book-progress', handleSyncBookProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (!progress?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Pull: pull progress once when the book is opened, with retry on failure
  useEffect(() => {
    if (!progress || hasPulledConfigOnce.current) return;
    hasPulledConfigOnce.current = true;
    pullWithRetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Clean up any pending retry timer on unmount so it doesn't fire after the
  // reader has been torn down.
  useEffect(() => {
    return () => clearPendingPullRetry();
  }, []);

  const applyRemoteProgress = async (syncedConfigs: BookConfig[]) => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!syncedConfigs || syncedConfigs.length === 0 || !config || !book) return;

    const bookHash = bookKey.split('-')[0]!;
    const metaHash = book.metaHash;
    // OPDS re-downloads mint a NEW book_hash for a re-packaged-but-identical
    // file, so the cloud accumulates several configs for one book: the exact
    // same-book_hash config plus same-metaHash SIBLINGS from other hashes.
    // Reconcile them like importBook's mergeBooks — furthest position wins — but
    // by PROVENANCE: only the same-hash config's CFI/xpointer resolve correctly
    // in THIS file; a sibling's CFI belongs to a different-bytes file and can
    // silently mis-resolve to a section start ("reset to page one", #5859), so a
    // sibling may contribute only its reading FRACTION, forward-only. Picking
    // the first match blindly is what let a stale/cross-file config move the
    // reader backward.
    const matches = syncedConfigs.filter((c) => c.bookHash === bookHash || c.metaHash === metaHash);
    // Base config for the device-agnostic viewSettings merge below (proofread
    // rules, reference page count). Prefer the exact same-file config.
    const syncedConfig = matches.find((c) => c.bookHash === bookHash) ?? matches[0];
    if (syncedConfig) {
      const bookData = getBookData(bookKey);
      const view = getView(bookKey);
      const isPreviewing = () =>
        useReaderStore.getState().getViewState(bookKey)?.previewMode ?? false;
      const announceSynced = () => {
        setHoveredBookKey(null);
        eventDispatcher.dispatch('hint', { bookKey, message: _('Reading Progress Synced') });
      };

      // The exact same-file config; its CFI/xpointer are valid in this document.
      let exactConfig = syncedConfig.bookHash === bookHash ? syncedConfig : undefined;
      // Discard a malformed synced location (an empty-start/end range CFI left by
      // the cfi-inert skip-link bug, e.g. `epubcfi(/6/24!/4,,/20/1:58)`) so it
      // can't move the reader or be persisted — a valid xpointer below can still
      // recover the real position.
      if (exactConfig?.location && isMalformedLocationCfi(exactConfig.location)) {
        exactConfig = { ...exactConfig, location: undefined };
      }
      // Furthest reading fraction among sibling copies (same metaHash, different
      // book_hash). progress[0]/progress[1] compares across re-packaged copies
      // of the same work; a CFI does not.
      const siblingFraction = matches
        .filter((c) => c.bookHash !== bookHash)
        .reduce((best, c) => Math.max(best, getConfigFraction(c) ?? 0), 0);
      const exactFraction = exactConfig ? (getConfigFraction(exactConfig) ?? 0) : 0;
      const localFraction = getBookProgress(bookKey)?.fraction ?? getConfigFraction(config) ?? 0;

      if (
        view &&
        !isPreviewing() &&
        siblingFraction > exactFraction &&
        siblingFraction > localFraction + SIBLING_FORWARD_EPSILON
      ) {
        // A sibling copy holds the furthest position after OPDS hash-churn.
        // Apply it ONLY by fraction (goToFraction resolves by cumulative section
        // size, never by node path), so it can't collapse to a section start the
        // way a cross-file CFI would.
        view.goToFraction(siblingFraction);
        announceSynced();
      } else if (exactConfig) {
        const configCFI = config?.location;
        let remoteCFILocation = exactConfig.location;
        const xpointer = exactConfig.xpointer;
        // The Readest KOReader plugin pushes `progress` + `xpointer` and never a
        // `location`, so its [page, total] is CREngine's own pagination. That
        // doubles as the anchor that corrects CREngine<->foliate DocFragment
        // drift and as the last-resort target when the XPointer won't convert.
        // A config that carries a CFI came from Readest, whose [page, total] is
        // foliate's pagination and whose xpointer was derived from that same
        // CFI — re-anchoring on it would only move the target off (#5109).
        const remoteFraction = exactConfig.location ? undefined : getConfigFraction(exactConfig);
        let xpointerUnresolved = false;
        if (xpointer && view && bookData && bookData.bookDoc) {
          const pContents = view.renderer.getContents();
          const pIdx = view.renderer.primaryIndex;
          const content = pContents.find((x) => x.index === pIdx) ?? pContents[0];
          try {
            const candidateCFI = await getCFIFromXPointer(
              xpointer,
              content?.doc,
              content?.index,
              bookData.bookDoc,
              remoteFraction,
            );
            if (!remoteCFILocation || CFI.compare(remoteCFILocation, candidateCFI) < 0) {
              remoteCFILocation = candidateCFI;
            }
          } catch (error) {
            // Never let one unconvertible XPointer reject the whole pull — the
            // proofread merge below still has to run, and swallowing the rest
            // silently is what let the debounced auto-push overwrite a newer
            // remote position with the local one (#5625).
            console.warn('Failed to convert XPointer to CFI', error);
            xpointerUnresolved = true;
          }
        }
        // Reading progress applies below. Proofread (find/replace) rules merge
        // separately just after; other config fields remain device-local.
        // TODO: general config sync via a more robust profile-based solution.
        if (remoteCFILocation && configCFI) {
          // While previewing a deep-link target, do NOT yank the view to the
          // remote position — the user came here to look at a specific
          // annotation. The local config still gets updated; the next open
          // resolves to the synced position normally.
          if (CFI.compare(configCFI, remoteCFILocation) < 0 && view && !isPreviewing()) {
            view.goTo(remoteCFILocation);
            announceSynced();
          }
        } else if (xpointerUnresolved && remoteFraction !== undefined) {
          // No CFI anywhere and the XPointer didn't resolve: the reported
          // fraction is all that's left. CREngine and foliate paginate
          // differently, so it's approximate — only ever move FORWARD with it,
          // matching the CFI branch, so an imprecise jump can't lose the
          // reader's place.
          if (view && !isPreviewing() && localFraction < remoteFraction) {
            view.goToFraction(remoteFraction);
            announceSynced();
          }
        }
      }
      // Two view settings cross devices; everything else in viewSettings stays
      // device-local. Both merges accumulate into one updatedViewSettings so a
      // pull that moves both still writes the config once.
      const localViewSettings = getViewSettings(bookKey);
      if (localViewSettings) {
        let updatedViewSettings = localViewSettings;
        let rulesChanged = false;
        // Merge book/selection-scope proofread rules from the remote config by id.
        // Library-scope rules sync via the settings replica, so they're excluded.
        // Item-level CRDT (see utils/proofread.ts) keeps a concurrent edit on
        // another device from being lost to whole-config last-writer-wins, and
        // tombstones stop a deleted rule from being resurrected by a stale peer.
        const remoteRules = (syncedConfig.viewSettings?.proofreadRules ?? []).filter(
          (r) => r.scope !== 'library',
        );
        const localRules = localViewSettings.proofreadRules ?? [];
        if (remoteRules.length || localRules.length) {
          const mergedRules = mergeProofreadRules(localRules, remoteRules);
          if (JSON.stringify(mergedRules) !== JSON.stringify(localRules)) {
            updatedViewSettings = { ...updatedViewSettings, proofreadRules: mergedRules };
            rulesChanged = true;
          }
        }
        // The reference page count describes the book's print edition, not this
        // screen, so it travels with reading state (issue #5716). Without this
        // a count typed on one device never reached the others, and the peer's
        // next push — carrying no count, because serializeConfig strips every
        // setting equal to global — erased it from the cloud row under the
        // server's whole-row last-writer-wins.
        const mergedPageCount = resolveReferencePageCount(
          localViewSettings.referencePageCount,
          syncedConfig.viewSettings?.referencePageCount,
          (syncedConfig.updatedAt ?? 0) > (config.updatedAt ?? 0),
        );
        // Compare against the NORMALIZED local value: an unset key and a 0 both
        // mean "no count", so neither may be rewritten into the other and bump
        // updatedAt on every book open.
        if (mergedPageCount !== (localViewSettings.referencePageCount ?? 0)) {
          updatedViewSettings = { ...updatedViewSettings, referencePageCount: mergedPageCount };
        }
        if (updatedViewSettings !== localViewSettings) {
          setViewSettings(bookKey, updatedViewSettings);
          await saveConfig(
            envConfig,
            bookKey,
            { ...config, viewSettings: updatedViewSettings, updatedAt: Date.now() },
            settings,
          );
          // Refresh a live view so merged rules take effect immediately; a
          // not-yet-rendered view picks them up from viewSettings on first
          // render. Skip while previewing a deep-link target. Only a rule
          // change needs this — the footer reads the page count straight off
          // viewSettings on its next render.
          const isPreview = useReaderStore.getState().getViewState(bookKey)?.previewMode;
          if (rulesChanged && getView(bookKey) && !isPreview) {
            recreateViewer(envConfig, bookKey);
          }
        }
      }
    }
  };

  // Pull: proccess the pulled progress
  useEffect(() => {
    if (!configPulled.current && syncedConfigs) {
      configPulled.current = true;
      // Pull succeeded — cancel any in-flight retry chain and reset the
      // attempt counter so a future sync-book-progress event starts clean.
      pullAttempt.current = 0;
      clearPendingPullRetry();
      applyRemoteProgress(syncedConfigs).catch((error) => {
        console.error('Failed to apply remote progress', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs]);
};
