import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { recordFlow } from '@/services/sync/dataFlow/log';
import { KOSyncClient, KoSyncProgress } from '@/services/sync/KOSyncClient';
import { Book, BookProgress, FIXED_LAYOUT_FORMATS } from '@/types/book';
import type { KOSyncSettings, SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import { BookDoc } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';
import { isMalformedLocationCfi } from '@/utils/cfi';
import {
  formatProgressPercentage,
  getLocalProgressPreview,
  getProgressPercentage,
} from './kosyncPreview';
import {
  decideRemoteConflict,
  getRemoteFraction,
  getRemotePage,
  isCfiOnPage,
  isCfiProgress,
  isXPointerProgress,
  resolveRemoteLocalFraction,
  type RemoteFractionResolution,
} from './kosyncProgress';
import { useWindowActiveChanged } from './useWindowActiveChanged';

type SyncState = 'idle' | 'checking' | 'conflict' | 'synced' | 'error';

/**
 * Source of the KOSync-protocol config this hook instance syncs against.
 * selectConfig returns null when the provider is not configured; the hook
 * then idles. The kosync provider preserves the original semantics: a client
 * exists once credentials are set, `enabled` is checked at pull/push time.
 */
export interface KosyncProgressProvider {
  name: 'kosync' | 'bookorbit' | 'grimmory';
  selectConfig: (settings: SystemSettings) => KosyncEngineConfig | null;
  /** A server that is not KOSync brings its own client; KOSync is the default. */
  createClient?: (config: KosyncEngineConfig, appService: AppService) => ProgressSyncClient;
  /** 'cfi': reflowable positions are EPUB CFIs, not CREngine XPointers. */
  positions?: 'cfi';
}

/** The part of KOSyncClient this hook drives. */
export interface ProgressSyncClient {
  getDocumentDigest(book: Book): string;
  getProgress(book: Book): Promise<KoSyncProgress | null>;
  updateProgress(book: Book, progress: string, percentage: number): Promise<unknown>;
  /** Why the last read or write failed, or null when it didn't. */
  lastError?: string | null;
}

/**
 * What this hook actually drives: the KOSync wire settings plus the knobs a
 * provider adds on top. `settings.kosync` satisfies it as-is.
 */
export type KosyncEngineConfig = KOSyncSettings & {
  /**
   * Manual-sync opt-out (#6029), set by BookOrbit only. When false the hook
   * never pushes on its own; the server hears from us only on an explicit
   * 'push-kosync'. Pulls stay automatic. Absent means automatic pushes, which
   * is what KOReader Sync has always done.
   */
  autoSync?: boolean;
};

export const kosyncProvider: KosyncProgressProvider = {
  name: 'kosync',
  selectConfig: (settings) =>
    settings.kosync.username && settings.kosync.userkey ? settings.kosync : null,
};

export interface SyncDetails {
  book: Book;
  bookDoc: BookDoc;
  local: {
    cfi?: string;
    preview: string;
  };
  remote: KoSyncProgress & {
    preview: string;
    percentage?: number;
  };
}

export const useKOSync = (bookKey: string, provider: KosyncProgressProvider = kosyncProvider) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  // Per-field selectors — methods are stable refs, so no subscription churn.
  const getProgress = useReaderStore((s) => s.getProgress);
  const getView = useReaderStore((s) => s.getView);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const book = useBookDataStore((s) => s.getBookData(bookKey)?.book);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);

  const [kosyncClient, setKOSyncClient] = useState<ProgressSyncClient | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [conflictDetails, setConflictDetails] = useState<SyncDetails | null>(null);
  const [errorMessage] = useState<string | null>(null);
  const hasPulledOnce = useRef(false);
  // The remote report the user last settled via the conflict dialog. A re-pull
  // (window re-activation, e.g. returning from a system dictionary popup) that
  // returns this exact unchanged report must not re-open the dialog — only a
  // report that changed since is a new conflict (#5527).
  const resolvedRemoteRef = useRef<KoSyncProgress | null>(null);
  // Whether this device had a reading position for the book when it was
  // opened, read before the view opens: the relocate that opens the book
  // writes config.location, and only then can the first pull run. A book
  // just added to this device has none, yet its record counts as newer than
  // any server report: its updatedAt is stamped when the record is created
  // on this open, after the other device's last sync. Under 'silent' that
  // kept the empty local record, left the reader at the start of the book
  // and pushed that start over the other device's position. Used only by the
  // first pull that gets an answer: after it, the device has a position of
  // its own (the server's, or the one read here) and the timestamps decide.
  const noLocalProgressRef = useRef(false);
  useEffect(() => {
    const config = getConfig(bookKey);
    if (config && !config.location) noLocalProgressRef.current = true;
  }, [bookKey, getConfig]);

  // Reactive subscription: drives the auto-push effect and the initial
  // pull-on-open effect below. Reads from readerProgressStore.
  const progress = useBookProgress(bookKey);

  const checksumMethod = provider.selectConfig(settings)?.checksumMethod;
  const checksumGeneration = useRef(0);
  const pendingPut = useRef<Promise<unknown>>(Promise.resolve());
  const pendingResumePush = useRef<Promise<unknown>>(Promise.resolve());
  const lastSentPosition = useRef<{
    client: ProgressSyncClient;
    generation: number;
    progress: string;
    percentage: number;
  } | null>(null);
  const documentDigest = kosyncClient && book ? kosyncClient.getDocumentDigest(book) : null;
  const previousDocumentDigest = useRef(documentDigest);

  useEffect(() => {
    const config = provider.selectConfig(settings);
    if (!config || (provider.createClient && !appService)) {
      setKOSyncClient(null);
      return;
    }
    const client = provider.createClient
      ? provider.createClient({ ...config }, appService!)
      : new KOSyncClient({ ...config });
    setKOSyncClient(client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, provider, checksumMethod, !!appService]);

  useEffect(() => {
    if (previousDocumentDigest.current === documentDigest) return;
    previousDocumentDigest.current = documentDigest;
    checksumGeneration.current += 1;
    hasPulledOnce.current = false;
    resolvedRemoteRef.current = null;
    setConflictDetails(null);
    setSyncState('idle');
  }, [documentDigest]);

  const generateKOProgress = useCallback(async () => {
    const generation = checksumGeneration.current;
    const progress = getProgress(bookKey);
    const bookData = getBookData(bookKey);
    if (!progress || !bookData) return null;

    let koProgress = '';
    let percentage: number;
    if (bookData.isFixedLayout) {
      // KOReader's progress for a paged document is the 1-based page number.
      const page = (progress.section?.current ?? 0) + 1;
      const totalPages = progress.section?.total ?? 0;
      koProgress = page.toString();
      percentage = totalPages > 0 ? page / totalPages : 0;
    } else {
      const view = getView(bookKey);
      const config = getConfig(bookKey);
      const cfi = progress.location;
      if (!view || !cfi) return null;
      if (provider.positions === 'cfi') {
        // A malformed CFI is skipped; there is no last good one kept for it.
        if (isMalformedLocationCfi(cfi)) return null;
        koProgress = cfi;
      } else if (isMalformedLocationCfi(cfi)) {
        // A malformed empty-start/end CFI (cfi-inert skip-link bug) resolves to
        // the wrong end of the section. Don't derive an XPointer from it — once
        // pushed as an XPointer the "malformed" signal is lost and other devices
        // can't discard it. Reuse the last known-good XPointer instead.
        if (config?.xpointer) koProgress = config.xpointer;
      } else {
        try {
          const koContents = view.renderer.getContents();
          const koPrimaryIdx = view.renderer.primaryIndex;
          const content = koContents.find((x) => x.index === koPrimaryIdx) ?? koContents[0];
          // progress.location may be a CFI in a different spine section than the
          // currently-rendered primary view (#primaryIndex can lag behind the
          // viewport while scrolling). Resolve against the CFI's own section
          // rather than forcing the primary view's document, which throws on a
          // spine-index mismatch.
          const xpointerResult = await getXPointerFromCFI(
            cfi,
            content?.doc,
            content?.index,
            bookData.bookDoc ?? undefined,
            bookData.book?.format,
          );
          if (generation !== checksumGeneration.current) return null;
          koProgress = xpointerResult.xpointer;
          setConfig(bookKey, { xpointer: koProgress });
        } catch (error) {
          console.error('Failed to convert CFI to XPointer', error);
          if (config?.xpointer) koProgress = config.xpointer;
        }
      }

      const page = progress.pageinfo?.current ?? 0;
      const totalPages = progress.pageinfo?.total ?? 0;
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    }

    return { koProgress, percentage };
  }, [bookKey, provider, getProgress, getBookData, getView, getConfig, setConfig]);

  /**
   * Applies the remote position to the view. Returns false when it could NOT
   * be applied, which the callers MUST honour: marking the pull 'synced' after
   * a failure releases the debounced auto-push, and that push overwrites the
   * newer remote position with the stale local one (#5065).
   */
  const applyRemoteProgress = async (
    book: Book,
    bookDoc: BookDoc,
    remote: KoSyncProgress,
    generation: number,
  ): Promise<boolean> => {
    const view = getView(bookKey);
    const bookData = getBookData(bookKey);
    if (!view || !bookData) return false;

    if (FIXED_LAYOUT_FORMATS.has(book.format)) {
      const pageToGo = getRemotePage(remote, getProgress(bookKey)?.section?.total ?? 0);
      if (pageToGo === undefined) return false;
      view.select(pageToGo - 1);
    } else {
      // KOReader stores positions as CREngine XPointers, which name an exact
      // node. When one is present it is the ONLY acceptable answer: if it
      // won't convert, say so and stay put rather than approximating from the
      // reported percentage. That percentage is CREngine's own pagination and
      // lands in the wrong chapter often enough to be worse than not syncing
      // (#5980). The pull stays in the unresolved/conflict state, so the
      // auto-push still cannot overwrite the remote position with this one.
      if (isCfiProgress(remote.progress)) {
        view.goTo(remote.progress!);
      } else if (isXPointerProgress(remote.progress)) {
        try {
          const content = view.renderer
            .getContents()
            .find((x) => x.index === view.renderer.primaryIndex);
          const cfi = await getCFIFromXPointer(
            remote.progress!,
            content?.doc,
            content?.index,
            bookDoc,
          );
          if (generation !== checksumGeneration.current) return false;
          view.goTo(cfi);
        } catch (error) {
          if (generation !== checksumGeneration.current) return false;
          console.error('Failed to convert XPointer to CFI', error);
          eventDispatcher.dispatch('hint', { bookKey, message: _('Sync failed') });
          return false;
        }
      } else {
        // Other KOSync-compatible servers (e.g. Kavita) report progress in
        // formats Readest can't resolve positionally. There the percentage is
        // the only signal there is, so it remains the target.
        const remoteFraction = getRemoteFraction(remote);
        if (remoteFraction === undefined) return false;
        view.goToFraction(remoteFraction);
      }
    }
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Reading Progress Synced'),
    });
    recordFlow({
      connector: provider.name,
      direction: 'pull',
      kind: 'progress',
      bookTitle: book.title,
    });
    return true;
  };

  const promptedSync = async (
    book: Book,
    bookDoc: BookDoc,
    local: BookProgress,
    remote: KoSyncProgress,
    generation: number,
  ) => {
    let remotePreview = '';
    const remotePercentage = remote.percentage || 0;
    // Progress last pushed from this same device is just our own earlier
    // position; only treat a sizeable jump (≥1%) as a conflict so we don't
    // prompt on the sub-page drift between a push and the next pull.
    const isSameDevice =
      !!remote.device_id && remote.device_id === provider.selectConfig(settings)?.deviceId;
    const conflictProgressDiffThreshold = isSameDevice ? 0.01 : 0.0001;
    // The remote progress as a percentage to compare against the local one;
    // refined to a locally-resolved fraction for reflowable books below.
    let remoteComparePercentage = remotePercentage;
    let showConflictDetails = false;
    const isFixedLayout = FIXED_LAYOUT_FORMATS.has(book.format);

    const localPreview = getLocalProgressPreview(local, isFixedLayout, _);
    const localPercentage = getProgressPercentage(isFixedLayout ? local.section : local.pageinfo);

    if (isFixedLayout) {
      const localPageInfo = local.section;
      const remotePage = getRemotePage(remote, localPageInfo?.total ?? 0);
      if (remotePage !== undefined && remotePercentage > 0) {
        const localTotalPages = localPageInfo?.total ?? 0;
        const hasRemotePage = !isNaN(parseInt(remote.progress ?? '', 10));
        // A page derived from a percentage alone is a page of the local copy,
        // and only approximate.
        const remoteTotalPages = hasRemotePage
          ? Math.round(remotePage / remotePercentage)
          : localTotalPages;
        const pagesMatch = hasRemotePage && Math.abs(localTotalPages - remoteTotalPages) <= 1;

        if (pagesMatch) {
          remotePreview = _('Page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: formatProgressPercentage(remotePercentage),
          });
        } else {
          remotePreview = _('Approximately page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: formatProgressPercentage(remotePercentage),
          });
        }
        // A rounded percentage won't equal the local one even on the same
        // page, so compare the page it names.
        showConflictDetails = hasRemotePage
          ? Math.abs(localPercentage - remotePercentage) > conflictProgressDiffThreshold
          : remotePage !== (localPageInfo?.current ?? 0) + 1;
      } else {
        remotePreview = _('Approximately {{percentage}}%', {
          percentage: formatProgressPercentage(remotePercentage),
        });
      }
    } else if (isSameDevice) {
      // A report this device pushed carries a percentage computed with the
      // same formula as localPercentage, so the two compare directly. Don't
      // round-trip our own XPointer through the CREngine drift correction:
      // it can mis-anchor or fail to resolve, and an 'unresolved' failure
      // would force a phantom conflict on every window re-activation (#5527).
      // The #5065 protection exists for OTHER devices' positions; overwriting
      // this device's own stale echo is fine.
      showConflictDetails =
        Math.abs(localPercentage - remotePercentage) > conflictProgressDiffThreshold;
      remotePreview = _('Approximately {{percentage}}%', {
        percentage: formatProgressPercentage(remotePercentage),
      });
    } else {
      // KOReader's reported percentage comes from its own pagination, so it's
      // not directly comparable to Readest's progress. Resolve the remote
      // position to a local fraction for an apples-to-apples comparison.
      //
      // Crucially, a KOReader XPointer that FAILS to resolve locally
      // ('unresolved') is not the same as "no conflict": its percentage isn't
      // comparable, so we must not conclude the positions match just because
      // the numbers happen to line up (the #5065 iOS bug). Only genuinely
      // non-resolvable formats ('not-xpointer', e.g. Kavita) fall back to the
      // reported percentage. See decideRemoteConflict for details.
      const view = getView(bookKey);
      const resolution: RemoteFractionResolution = view
        ? await resolveRemoteLocalFraction(remote, view, bookDoc)
        : {
            status:
              isXPointerProgress(remote.progress) || isCfiProgress(remote.progress)
                ? 'unresolved'
                : 'not-xpointer',
          };
      const decision = decideRemoteConflict(
        resolution,
        localPercentage,
        remotePercentage,
        conflictProgressDiffThreshold,
      );
      const isOnThisPage =
        isCfiProgress(remote.progress) && isCfiOnPage(remote.progress!, local.location);
      remoteComparePercentage = decision.comparePercentage;
      showConflictDetails = !isOnThisPage && decision.showConflictDetails;
      remotePreview = _('Approximately {{percentage}}%', {
        percentage: formatProgressPercentage(remoteComparePercentage),
      });
    }

    if (generation !== checksumGeneration.current) return false;
    if (showConflictDetails) {
      setConflictDetails({
        book,
        bookDoc,
        local: { cfi: local.location, preview: localPreview },
        remote: { ...remote, preview: remotePreview },
      });
    }
    return showConflictDetails;
  };

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        if (!bookKey || !appService || !kosyncClient || !hasPulledOnce.current) return;
        const { settings } = useSettingsStore.getState();
        const config = provider.selectConfig(settings);
        if (
          !config ||
          config.checksumMethod !== checksumMethod ||
          ['receive', 'disable'].includes(config.strategy)
        )
          return;

        const generation = checksumGeneration.current;
        const currentBook = getBookData(bookKey)?.book;
        if (!currentBook || kosyncClient.getDocumentDigest(currentBook) !== documentDigest) return;
        const push = async () => {
          const progress = await generateKOProgress();
          if (generation !== checksumGeneration.current || !progress?.koProgress) return;
          const put = pendingPut.current.then(async () => {
            if (generation !== checksumGeneration.current) return;
            console.log('[KOSync] Pushing progress');
            const sent = await kosyncClient.updateProgress(
              currentBook,
              progress.koProgress,
              progress.percentage,
            );
            if (sent && generation === checksumGeneration.current) {
              lastSentPosition.current = {
                client: kosyncClient,
                generation,
                progress: progress.koProgress,
                percentage: progress.percentage,
              };
            }
            recordFlow({
              connector: provider.name,
              direction: 'push',
              kind: 'progress',
              bookTitle: currentBook.title,
              count: sent ? 1 : 0,
              error: kosyncClient.lastError ?? undefined,
            });
          });
          pendingPut.current = put.catch(() => undefined);
          await put;
        };
        const task = push();
        pendingResumePush.current = task.catch(() => undefined);
        await task;
      }, 5000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, kosyncClient, documentDigest],
  );

  const pullProgress = useCallback(
    async ({ onResume = false } = {}) => {
      if (!progress?.location || !appService || !kosyncClient) return;

      const bookData = getBookData(bookKey);
      const book = bookData?.book;
      const bookDoc = bookData?.bookDoc;
      if (!book || !bookDoc) return;

      const config = provider.selectConfig(settings);
      if (!config?.enabled) return;
      const { strategy } = config;
      const generation = checksumGeneration.current;

      hasPulledOnce.current = true;
      if (strategy === 'send') {
        setSyncState('synced');
        return;
      }

      setSyncState('checking');
      const locationAtPull = getProgress(bookKey)?.location;
      if (onResume) await pendingResumePush.current;
      await pendingPut.current;
      if (generation !== checksumGeneration.current) return;
      const remoteProgress = await kosyncClient.getProgress(book);
      if (generation !== checksumGeneration.current) return;
      // Only the first answer after open can find the device without a
      // position; from then on the timestamps decide, even if it was empty.
      // Reading on while it was on its way gives the device a position too.
      const noLocalProgress =
        noLocalProgressRef.current && getProgress(bookKey)?.location === locationAtPull;
      noLocalProgressRef.current = false;
      recordFlow({
        connector: provider.name,
        direction: 'pull',
        kind: 'progress',
        bookTitle: book.title,
        count: 0,
        error: kosyncClient.lastError ?? undefined,
      });
      // A position may be a percentage alone (Grimmory's own reader, #7330).
      if (
        !remoteProgress ||
        (!remoteProgress.progress && getRemoteFraction(remoteProgress) === undefined)
      ) {
        setSyncState('synced');
        return;
      }
      console.log('[KOSync] Pulled remote progress', { bookKey, remoteProgress });

      const localTimestamp = bookData?.config?.updatedAt || book.updatedAt;
      const remoteTimestamp = remoteProgress.timestamp
        ? remoteProgress.timestamp * 1000
        : Date.now();
      const remoteIsNewer = remoteTimestamp > localTimestamp;
      // A record created on this open holds no position for the timestamps
      // to protect: take the server's.
      const takeRemote = remoteIsNewer || noLocalProgress;
      if (strategy === 'receive' || (strategy === 'silent' && takeRemote)) {
        const applied = await applyRemoteProgress(book, bookDoc, remoteProgress, generation);
        if (generation !== checksumGeneration.current) return;
        setSyncState(applied ? 'synced' : 'error');
      } else if (strategy === 'prompt') {
        const resolved = resolvedRemoteRef.current;
        const isAlreadyResolved =
          !!resolved &&
          resolved.progress === remoteProgress.progress &&
          resolved.percentage === remoteProgress.percentage &&
          resolved.timestamp === remoteProgress.timestamp &&
          resolved.device_id === remoteProgress.device_id;
        // Parallel views share a device ID. Only ignore an echo of a position
        // this view successfully sent to the current sync destination.
        const lastSent = lastSentPosition.current;
        const isOwnResumePosition =
          onResume &&
          !!remoteProgress.device_id &&
          remoteProgress.device_id === config.deviceId &&
          lastSent?.client === kosyncClient &&
          lastSent.generation === generation &&
          lastSent.progress === remoteProgress.progress &&
          lastSent.percentage === remoteProgress.percentage;
        if (isAlreadyResolved || isOwnResumePosition) {
          setSyncState('synced');
          return;
        }
        // Only stay in the conflict state when there's an actual conflict to
        // resolve; otherwise return to 'synced' so auto-push keeps working.
        const hasConflict = await promptedSync(book, bookDoc, progress, remoteProgress, generation);
        if (generation !== checksumGeneration.current) return;
        if (hasConflict) pushProgress.cancel();
        setSyncState(hasConflict ? 'conflict' : 'synced');
      } else {
        setSyncState('synced');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, kosyncClient, settings, progress, pushProgress],
  );

  // use a ref to track the current push/pull functions so they can change without triggering effects
  const syncRefs = useRef({ pushProgress, pullProgress });
  useEffect(() => {
    syncRefs.current = { pushProgress, pullProgress };
  }, [pushProgress, pullProgress]);

  // The KOSync and BookOrbit instances of this hook listen on the same event
  // names, so a book-menu entry meant for one server would otherwise reach
  // both. `detail.provider` addresses exactly one instance; an event without
  // one still broadcasts (book close, the reader's Sync row).
  const providerName = provider.name;
  const isAddressedHere = useCallback(
    (event: CustomEvent) =>
      event.detail.bookKey === bookKey &&
      (!event.detail.provider || event.detail.provider === providerName),
    [bookKey, providerName],
  );

  useEffect(() => {
    const handlePushProgress = (event: CustomEvent) => {
      const { pushProgress } = syncRefs.current;
      if (!isAddressedHere(event)) return;
      pushProgress();
      pushProgress.flush();
    };
    const handleFlush = (event: CustomEvent) => {
      const { pushProgress } = syncRefs.current;
      if (!isAddressedHere(event)) return;
      pushProgress.flush();
    };
    eventDispatcher.on('push-kosync', handlePushProgress);
    eventDispatcher.on('flush-kosync', handleFlush);
    return () => {
      const { pushProgress } = syncRefs.current;
      eventDispatcher.off('push-kosync', handlePushProgress);
      eventDispatcher.off('flush-kosync', handleFlush);
      pushProgress.flush();
    };
  }, [isAddressedHere]);

  useEffect(() => {
    const handlePullProgress = (event: CustomEvent) => {
      if (!isAddressedHere(event)) return;
      const { pullProgress } = syncRefs.current;
      pullProgress();
    };
    eventDispatcher.on('pull-kosync', handlePullProgress);
    return () => {
      eventDispatcher.off('pull-kosync', handlePullProgress);
    };
  }, [isAddressedHere]);

  // Pull: pull progress once when the book is opened
  useEffect(() => {
    if (!appService || !kosyncClient || !progress?.location) return;
    if (hasPulledOnce.current) return;

    syncRefs.current.pullProgress();
  }, [appService, kosyncClient, progress?.location, documentDigest]);

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (syncState === 'synced' && progress) {
      // Skip auto-pushes while previewing a deep-link target. Manual pushes
      // via the 'push-kosync' event are still respected (explicit user intent).
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
      const config = provider.selectConfig(settings);
      // Auto Sync off (#6029): the server only hears from us when the user
      // asks, via 'push-kosync'. Pulls below stay automatic.
      if (config?.enabled && config.strategy !== 'receive' && config.autoSync !== false) {
        syncRefs.current.pushProgress();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, syncState, settings, bookKey]);

  useWindowActiveChanged((isActive) => {
    if (syncState === 'conflict') return;
    const { pushProgress, pullProgress } = syncRefs.current;

    if (isActive) {
      hasPulledOnce.current = false;
      pullProgress({ onResume: true });
    } else {
      // Nothing is ever pending in manual mode, so this pair would be the one
      // automatic push that still got through — schedule then flush.
      if (provider.selectConfig(useSettingsStore.getState().settings)?.autoSync === false) return;
      pushProgress();
      pushProgress.flush();
    }
  });

  const resolveWithLocal = () => {
    resolvedRemoteRef.current = conflictDetails?.remote ?? null;
    pushProgress();
    pushProgress.flush();
    setSyncState('synced');
    setConflictDetails(null);
  };

  const resolveWithRemote = async () => {
    const view = getView(bookKey);
    const remote = conflictDetails?.remote;
    const book = conflictDetails?.book;
    const bookDoc = conflictDetails?.bookDoc;

    if (!book || !bookDoc || !remote || !view) return;
    if (!remote.progress && getRemoteFraction(remote) === undefined) return;

    const generation = checksumGeneration.current;
    resolvedRemoteRef.current = remote;
    const applied = await applyRemoteProgress(book, bookDoc, remote, generation);
    if (generation !== checksumGeneration.current) return;
    setSyncState(applied ? 'synced' : 'error');
    setConflictDetails(null);
  };

  return {
    syncState,
    conflictDetails,
    errorMessage,
    pushProgress,
    pullProgress,
    resolveWithLocal,
    resolveWithRemote,
  };
};
