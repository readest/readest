import { useCallback, useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import { ParagraphIterator } from '@/utils/paragraph';
import { getParagraphPresentation } from '@/utils/paragraphPresentation';
import { DEFAULT_PARAGRAPH_MODE_CONFIG } from '@/services/constants';
import { isRangeLike } from '@/utils/range';
import {
  buildParagraphTtsSpeakDetail,
  computeParagraphHighlightOffsets,
  decideParagraphTtsHighlight,
} from '@/app/reader/components/paragraph/paragraphTts';

interface UseParagraphModeProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
}

// Derived state for the TTS-sync indicator (later slice renders it).
//  - 'unsupported': fixed-layout book; sync can never engage.
//  - 'idle':        TTS not playing / not engaged.
//  - 'following':   actively following the spoken position.
//  - 'syncing':     a cross-section position is pending a re-init.
//  - 'decoupled':   was following, user took manual control (TTS still playing).
export type TtsSyncStatus =
  | 'unsupported'
  | 'idle'
  | 'following'
  | 'syncing'
  | 'decoupled'
  | 'paused';

export interface ParagraphState {
  isActive: boolean;
  isLoading: boolean;
  currentIndex: number;
  totalParagraphs: number;
  currentRange: Range | null;
}

export const useParagraphMode = ({ bookKey, viewRef }: UseParagraphModeProps) => {
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings, getProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();

  // Fixed-layout gate (D7): paragraph mode must never engage TTS sync for a
  // fixed-layout book. Mirrors how other reader code reads the flag.
  const isFixedLayout = getBookData(bookKey)?.isFixedLayout ?? false;

  const iteratorRef = useRef<ParagraphIterator | null>(null);
  const currentDocIndexRef = useRef<number | undefined>(undefined);
  const isProcessingRef = useRef(false);
  const isFocusingRef = useRef(false);
  const focusResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookKeyRef = useRef(bookKey);
  const pendingNavigationRef = useRef<'next' | 'prev' | null>(null);
  const initPromiseRef = useRef<Promise<boolean> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMountRef = useRef(true);
  const toggleInFlightRef = useRef(false);
  const lastParagraphRef = useRef<{
    progressLocation: string;
    paragraphCfi: string;
    docIndex: number;
  } | null>(null);
  // TTS-sync (one-way follower): TTS is the clock, paragraph mode follows it.
  const followingTtsRef = useRef(false);
  const lastSequenceSeenRef = useRef(-Infinity);
  const pendingSyncRef = useRef<{
    cfi: string;
    sequence: number;
    sectionIndex: number;
    kind?: 'word' | 'sentence';
  } | null>(null);
  // Whether the active TTS session has emitted word boundaries (Edge). Drives the
  // word-vs-sentence highlight granularity; reset when a session fully stops.
  const hasWordPositionsRef = useRef(false);
  // Holds the latest applySyncCfi so initIterator can apply a pending cross-
  // section sync after re-init without a circular useCallback dependency.
  const applySyncCfiRef = useRef<((cfi: string, highlight: boolean) => void) | null>(null);
  // Latest TTS playback-state for this book ('playing' vs not), used to derive
  // the sync status alongside the follow/pending refs.
  const ttsPlayingRef = useRef(false);
  // A TTS session exists (playing OR paused) for this book. Distinct from
  // ttsPlayingRef so a pause keeps the indicator + audio toggle "active" (the
  // mode is still on); only a full stop clears it. Drives the bar's audio toggle.
  const ttsActiveRef = useRef(false);
  const refreshTtsSyncStatusRef = useRef<(() => void) | null>(null);
  bookKeyRef.current = bookKey;

  const [paragraphState, setParagraphState] = useState<ParagraphState>({
    isActive: false,
    isLoading: false,
    currentIndex: -1,
    totalParagraphs: 0,
    currentRange: null,
  });

  const [ttsSyncStatus, setTtsSyncStatus] = useState<TtsSyncStatus>(
    isFixedLayout ? 'unsupported' : 'idle',
  );

  // Whether a TTS session is engaged (playing or paused) for this book. Drives
  // the bar's audio toggle active/idle glyph (#3235).
  const [ttsActive, setTtsActive] = useState(false);

  // Derive the indicator status from the current refs + the latest playback
  // state and push it to React state so the indicator re-renders. Fixed-layout
  // always wins.
  const refreshTtsSyncStatus = useCallback(() => {
    setTtsSyncStatus(() => {
      if (isFixedLayout) return 'unsupported';
      // No session at all (never started / fully stopped): idle.
      if (!ttsActiveRef.current) return 'idle';
      // Engaged but paused: keep the indicator visible (mode still on).
      if (!ttsPlayingRef.current) return 'paused';
      if (!followingTtsRef.current) return 'decoupled';
      if (pendingSyncRef.current) return 'syncing';
      return 'following';
    });
  }, [isFixedLayout]);
  // Lets initIterator refresh the status after clearing a pending sync without
  // pulling refreshTtsSyncStatus into its (widely-depended-on) deps array.
  refreshTtsSyncStatusRef.current = refreshTtsSyncStatus;

  const paragraphConfig = getViewSettings(bookKey)?.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;

  const getPrimaryContent = useCallback(() => {
    const view = viewRef.current;
    if (!view) return null;

    const contents = view.renderer.getContents();
    if (contents.length === 0) return null;

    const primaryIndex = view.renderer.primaryIndex;
    return contents.find((content) => content.index === primaryIndex) ?? contents[0] ?? null;
  }, [viewRef]);

  const updateStateFromIterator = useCallback(
    (isLoading = false) => {
      const iterator = iteratorRef.current;
      if (!iterator) {
        setParagraphState({
          isActive: paragraphConfig.enabled,
          isLoading,
          currentIndex: -1,
          totalParagraphs: 0,
          currentRange: null,
        });
        return;
      }
      setParagraphState({
        isActive: paragraphConfig.enabled,
        isLoading,
        currentIndex: iterator.currentIndex,
        totalParagraphs: iterator.length,
        currentRange: iterator.current(),
      });
    },
    [paragraphConfig.enabled],
  );

  const initIterator = useCallback(async (): Promise<boolean> => {
    if (isProcessingRef.current) {
      return initPromiseRef.current ?? false;
    }
    isProcessingRef.current = true;
    setParagraphState((prev) => ({ ...prev, isLoading: true }));

    const initPromise = (async (): Promise<boolean> => {
      try {
        const view = viewRef.current;
        if (!view) return false;

        const content = getPrimaryContent();
        const { doc, index } = content ?? {};
        const docIndex = index ?? view.renderer.primaryIndex;
        if (!doc) return false;

        currentDocIndexRef.current = docIndex;

        await new Promise((r) => requestAnimationFrame(r));
        iteratorRef.current = await ParagraphIterator.createAsync(doc);

        const pendingNav = pendingNavigationRef.current;
        pendingNavigationRef.current = null;

        if (pendingNav === 'next') {
          iteratorRef.current.first();
          updateStateFromIterator(false);
          return true;
        } else if (pendingNav === 'prev') {
          iteratorRef.current.last();
          updateStateFromIterator(false);
          return true;
        }

        const progress = getProgress(bookKeyRef.current);
        const progressRange = progress?.range;
        const progressLocation = progress?.location;
        const isSameDoc = progressRange?.startContainer?.ownerDocument === doc;
        const lastParagraph = lastParagraphRef.current;

        const resolveRangeFromLocation = (): Range | null => {
          if (!progressLocation) return null;
          try {
            const resolved = view.resolveCFI(progressLocation);
            if (!resolved || resolved.index !== docIndex) return null;
            const anchor = resolved.anchor(doc);
            // Realm-safe: iframe-realm Range fails top-realm `instanceof Range`.
            if (isRangeLike(anchor)) return anchor;
            if (anchor) {
              const range = doc.createRange();
              range.selectNodeContents(anchor);
              return range;
            }
          } catch {
            return null;
          }
          return null;
        };

        const resolveRangeFromLastParagraph = (): Range | null => {
          if (!lastParagraph || !progressLocation) return null;
          if (lastParagraph.progressLocation !== progressLocation) return null;
          if (lastParagraph.docIndex !== docIndex) return null;
          try {
            const resolved = view.resolveCFI(lastParagraph.paragraphCfi);
            if (!resolved || resolved.index !== docIndex) return null;
            const anchor = resolved.anchor(doc);
            // Realm-safe: iframe-realm Range fails top-realm `instanceof Range`.
            if (isRangeLike(anchor)) return anchor;
            if (anchor) {
              const range = doc.createRange();
              range.selectNodeContents(anchor);
              return range;
            }
          } catch {
            return null;
          }
          return null;
        };

        const targetRange =
          resolveRangeFromLastParagraph() ??
          (isSameDoc ? progressRange : resolveRangeFromLocation());

        if (targetRange && iteratorRef.current) {
          try {
            await iteratorRef.current.findByRangeAsync(targetRange);
          } catch {
            iteratorRef.current.first();
          }
        } else {
          iteratorRef.current.first();
        }

        updateStateFromIterator(false);

        // Apply a pending cross-section TTS sync once the iterator targets the
        // CFI's section and that sync is still the latest sequence seen.
        const pending = pendingSyncRef.current;
        if (
          pending &&
          followingTtsRef.current &&
          pending.sectionIndex === currentDocIndexRef.current &&
          pending.sequence >= lastSequenceSeenRef.current
        ) {
          pendingSyncRef.current = null;
          const action = decideParagraphTtsHighlight({
            kind: pending.kind,
            hasWordPositions: hasWordPositionsRef.current,
          });
          applySyncCfiRef.current?.(pending.cfi, action !== 'skip');
          refreshTtsSyncStatusRef.current?.();
        }
        return true;
      } finally {
        isProcessingRef.current = false;
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = initPromise;
    return initPromise;
  }, [getPrimaryContent, viewRef, getProgress, updateStateFromIterator]);

  const focusCurrentParagraph = useCallback(async () => {
    const view = viewRef.current;
    const iterator = iteratorRef.current;
    if (!view || !iterator) return;

    const range = iterator.current();
    if (!range) return;

    await new Promise((r) => requestAnimationFrame(r));

    if (focusResetTimerRef.current) {
      clearTimeout(focusResetTimerRef.current);
    }

    const presentation = getParagraphPresentation(
      range.startContainer.ownerDocument,
      range,
      getViewSettings(bookKeyRef.current),
    );

    isFocusingRef.current = true;
    const docIndex = currentDocIndexRef.current;
    const renderer = view.renderer as FoliateView['renderer'] & {
      goTo?: (target: { index: number; anchor: Range }) => Promise<void>;
    };
    if (docIndex !== undefined && renderer.goTo) {
      renderer.goTo({ index: docIndex, anchor: range });
    } else {
      view.renderer.scrollToAnchor?.(range);
    }
    focusResetTimerRef.current = setTimeout(() => {
      isFocusingRef.current = false;
    }, 200);

    eventDispatcher.dispatch('paragraph-focus', {
      bookKey: bookKeyRef.current,
      range,
      index: iterator.currentIndex,
      total: iterator.length,
      presentation,
    });
  }, [getViewSettings, viewRef]);

  // Sync-focus path for TTS following. Moves focus to `index` and scrolls/emits
  // exactly like focusCurrentParagraph but WITHOUT arming isFocusingRef. The
  // 200ms isFocusingRef window makes the relocate handler skip re-init; if a
  // TTS-driven focus armed it, the subsequent TTS section-change relocate would
  // be eaten and the iterator would never re-init for the new section (it would
  // then focus paragraph 0 of the wrong section). Re-entrancy from this
  // programmatic scroll's own relocate is instead prevented by the
  // lastSequenceSeen / section-match guards on the tts-position handler.
  const focusParagraphForSync = useCallback(
    async (index: number) => {
      const view = viewRef.current;
      const iterator = iteratorRef.current;
      if (!view || !iterator) return;

      const range = iterator.goTo(index);
      if (!range) return;
      updateStateFromIterator();

      await new Promise((r) => requestAnimationFrame(r));

      const presentation = getParagraphPresentation(
        range.startContainer.ownerDocument,
        range,
        getViewSettings(bookKeyRef.current),
      );

      const docIndex = currentDocIndexRef.current;
      const renderer = view.renderer as FoliateView['renderer'] & {
        goTo?: (target: { index: number; anchor: Range }) => Promise<void>;
      };
      if (docIndex !== undefined && renderer.goTo) {
        renderer.goTo({ index: docIndex, anchor: range });
      } else {
        view.renderer.scrollToAnchor?.(range);
      }

      eventDispatcher.dispatch('paragraph-focus', {
        bookKey: bookKeyRef.current,
        range,
        index: iterator.currentIndex,
        total: iterator.length,
        presentation,
      });
    },
    [getViewSettings, viewRef, updateStateFromIterator],
  );

  // Resolve a TTS cfi to the matching paragraph index in the current section and
  // sync-focus it. No-op when the cfi can't be resolved or maps nowhere (-1).
  // When `highlight` is set, also dispatch the spoken word/sentence offsets so
  // the overlay highlights the current text within the focused paragraph (#3235);
  // this fires even when the paragraph doesn't change (word moving within it).
  const applySyncCfi = useCallback(
    (cfi: string, highlight: boolean) => {
      const view = viewRef.current;
      const iterator = iteratorRef.current;
      const docIndex = currentDocIndexRef.current;
      if (!view || !iterator || docIndex === undefined) return;

      let range: Range | null = null;
      try {
        const resolved = view.resolveCFI(cfi);
        if (!resolved || resolved.index !== docIndex) return;
        const content = getPrimaryContent();
        const doc = content?.doc;
        if (!doc) return;
        const anchor = resolved.anchor(doc);
        // Realm-safe: iframe-realm Range fails top-realm `instanceof Range`.
        if (isRangeLike(anchor)) {
          range = anchor;
        } else if (anchor) {
          range = doc.createRange();
          range.selectNodeContents(anchor);
        }
      } catch {
        return;
      }
      if (!range) return;

      const index = iterator.findIndexByRange(range, iterator.currentIndex);
      if (index < 0) return;

      // Move focus only when the spoken position crossed into another paragraph;
      // goTo() runs synchronously so iterator.current() is the target afterwards.
      if (index !== iterator.currentIndex) {
        focusParagraphForSync(index);
      }

      if (highlight) {
        const paragraphRange = iterator.current();
        const offsets = paragraphRange
          ? computeParagraphHighlightOffsets(paragraphRange, range)
          : null;
        if (offsets) {
          eventDispatcher.dispatch('paragraph-tts-highlight', {
            bookKey: bookKeyRef.current,
            index,
            start: offsets.start,
            end: offsets.end,
          });
        }
      }
    },
    [viewRef, getPrimaryContent, focusParagraphForSync],
  );
  applySyncCfiRef.current = applySyncCfi;

  const waitForNewSection = useCallback(
    async (oldIndex: number | undefined, maxAttempts: number = 15): Promise<boolean> => {
      const view = viewRef.current;
      if (!view) return false;

      for (let i = 0; i < maxAttempts; i++) {
        const primaryContent = getPrimaryContent();
        if (
          primaryContent?.doc &&
          view.renderer.primaryIndex >= 0 &&
          view.renderer.primaryIndex !== oldIndex
        ) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 50 * (i + 1)));
      }
      return false;
    },
    [getPrimaryContent, viewRef],
  );

  const goToNextParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

    // Manual nav decouples from TTS following until the user re-engages.
    followingTtsRef.current = false;
    pendingSyncRef.current = null;
    refreshTtsSyncStatus();

    const range = iterator.next();
    if (range) {
      updateStateFromIterator();
      focusCurrentParagraph();
      return true;
    }

    const oldSectionIndex = currentDocIndexRef.current;
    pendingNavigationRef.current = 'next';
    iteratorRef.current = null;

    eventDispatcher.dispatch('paragraph-section-changing', {
      bookKey: bookKeyRef.current,
      direction: 'next',
    });

    try {
      await view.renderer.nextSection?.();
      const newSectionReady = await waitForNewSection(oldSectionIndex);

      if (!newSectionReady) {
        pendingNavigationRef.current = null;
        pendingNavigationRef.current = 'prev';
        await initIterator();
        focusCurrentParagraph();
        return false;
      }

      const success = await initIterator();
      if (success) {
        focusCurrentParagraph();
      }
      return success;
    } catch (e) {
      console.warn('[ParagraphMode] Section navigation failed:', e);
      pendingNavigationRef.current = null;
      await initIterator();
      focusCurrentParagraph();
      return false;
    }
  }, [
    viewRef,
    updateStateFromIterator,
    focusCurrentParagraph,
    initIterator,
    waitForNewSection,
    refreshTtsSyncStatus,
  ]);

  const goToPrevParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

    // Manual nav decouples from TTS following until the user re-engages.
    followingTtsRef.current = false;
    pendingSyncRef.current = null;
    refreshTtsSyncStatus();

    const range = iterator.prev();
    if (range) {
      updateStateFromIterator();
      focusCurrentParagraph();
      return true;
    }

    const oldSectionIndex = currentDocIndexRef.current;
    pendingNavigationRef.current = 'prev';
    iteratorRef.current = null;

    eventDispatcher.dispatch('paragraph-section-changing', {
      bookKey: bookKeyRef.current,
      direction: 'prev',
    });

    try {
      await view.renderer.prevSection?.();
      const newSectionReady = await waitForNewSection(oldSectionIndex);

      if (!newSectionReady) {
        pendingNavigationRef.current = null;
        pendingNavigationRef.current = 'next';
        await initIterator();
        focusCurrentParagraph();
        return false;
      }

      const success = await initIterator();
      if (success) {
        focusCurrentParagraph();
      }
      return success;
    } catch (e) {
      console.warn('[ParagraphMode] Section navigation failed:', e);
      pendingNavigationRef.current = null;
      await initIterator();
      focusCurrentParagraph();
      return false;
    }
  }, [
    viewRef,
    updateStateFromIterator,
    focusCurrentParagraph,
    initIterator,
    waitForNewSection,
    refreshTtsSyncStatus,
  ]);

  // Re-engage TTS following after a manual nav decoupled it (indicator's
  // "Resume audio" action). Sets following back on and refreshes the derived
  // status; the next tts-position event re-syncs the focused paragraph. No-op
  // on fixed-layout (sync is unsupported there).
  const reengageTtsFollow = useCallback(() => {
    if (isFixedLayout) return;
    followingTtsRef.current = true;
    refreshTtsSyncStatus();
  }, [isFixedLayout, refreshTtsSyncStatus]);

  // Audio (TTS) toggle from the paragraph bar (#3235). When a TTS session is
  // engaged, stop it; otherwise start it from the FOCUSED paragraph with
  // start-alignment — the paragraph's range (validated live) + its section index
  // — so audio begins at the same paragraph that's highlighted. Mirrors RSVP's
  // handleToggleTtsAudio.
  const toggleTtsAudio = useCallback(() => {
    if (ttsActiveRef.current) {
      eventDispatcher.dispatch('tts-stop', { bookKey: bookKeyRef.current });
      return;
    }
    const range = iteratorRef.current?.current() ?? null;
    const docIndex = currentDocIndexRef.current;
    // The doc the focused paragraph lives in (current primary content), used to
    // validate the range is live before passing it along.
    const currentDoc = getPrimaryContent()?.doc;
    const detail = buildParagraphTtsSpeakDetail(range, docIndex, bookKeyRef.current, currentDoc);
    eventDispatcher.dispatch('tts-speak', detail);
  }, [getPrimaryContent]);

  const goToParagraph = useCallback(
    (index: number) => {
      const iterator = iteratorRef.current;
      if (!iterator) return false;

      const range = iterator.goTo(index);
      if (range) {
        updateStateFromIterator();
        focusCurrentParagraph();
        return true;
      }
      return false;
    },
    [updateStateFromIterator, focusCurrentParagraph],
  );

  const toggleParagraphMode = useCallback(async () => {
    const settings = getViewSettings(bookKeyRef.current);
    if (!settings) return;
    if (toggleInFlightRef.current) return;

    toggleInFlightRef.current = true;
    try {
      const currentConfig = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
      const newEnabled = !currentConfig.enabled;
      const newConfig = { ...currentConfig, enabled: newEnabled };

      if (newEnabled) {
        setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
        saveViewSettings(envConfig, bookKeyRef.current, 'paragraphMode', newConfig, true, false);

        const success = await initIterator();
        if (success) {
          await focusCurrentParagraph();
        }
      } else {
        setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
        saveViewSettings(envConfig, bookKeyRef.current, 'paragraphMode', newConfig, true, false);

        const view = viewRef.current;
        const iterator = iteratorRef.current;
        if (view && iterator) {
          const range = iterator.current();
          if (range) {
            const progressLocation = getProgress(bookKeyRef.current)?.location;
            const docIndex = currentDocIndexRef.current;
            if (progressLocation && docIndex !== undefined) {
              const paragraphCfi = view.getCFI(docIndex, range);
              lastParagraphRef.current = {
                progressLocation,
                paragraphCfi,
                docIndex,
              };
            }
            view.renderer.scrollToAnchor?.(range);
          }
        }
        eventDispatcher.dispatch('paragraph-mode-disabled', { bookKey: bookKeyRef.current });
        iteratorRef.current = null;
        updateStateFromIterator();
      }
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [
    getViewSettings,
    setViewSettings,
    getProgress,
    envConfig,
    initIterator,
    focusCurrentParagraph,
    viewRef,
    updateStateFromIterator,
  ]);

  useEffect(() => {
    if (!isFirstMountRef.current) return;
    isFirstMountRef.current = false;

    if (paragraphConfig.enabled && !iteratorRef.current && !isProcessingRef.current) {
      const init = async () => {
        const success = await initIterator();
        if (success) {
          await focusCurrentParagraph();
        }
      };
      const timer = setTimeout(init, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const executeRelocateHandler = async () => {
      if (
        paragraphConfig.enabled &&
        !isProcessingRef.current &&
        !pendingNavigationRef.current &&
        !iteratorRef.current
      ) {
        await initIterator();
      }
    };

    const handleRelocate = () => {
      if (isFocusingRef.current) {
        isFocusingRef.current = false;
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(executeRelocateHandler, 100);
    };

    view.renderer.addEventListener('relocate', handleRelocate);
    return () => {
      view.renderer.removeEventListener('relocate', handleRelocate);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [viewRef, paragraphConfig.enabled, initIterator]);

  useEffect(() => {
    const handleToggle = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current) {
        toggleParagraphMode();
      }
    };

    const handleNext = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current && paragraphConfig.enabled) {
        goToNextParagraph();
      }
    };

    const handlePrev = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current && paragraphConfig.enabled) {
        goToPrevParagraph();
      }
    };

    eventDispatcher.on('toggle-paragraph-mode', handleToggle);
    eventDispatcher.on('paragraph-next', handleNext);
    eventDispatcher.on('paragraph-prev', handlePrev);

    return () => {
      eventDispatcher.off('toggle-paragraph-mode', handleToggle);
      eventDispatcher.off('paragraph-next', handleNext);
      eventDispatcher.off('paragraph-prev', handlePrev);
    };
  }, [toggleParagraphMode, goToNextParagraph, goToPrevParagraph, paragraphConfig.enabled]);

  // TTS sync (one-way follower): while paragraph mode is active, follow the
  // spoken position. TTS is the clock; this never drives TTS back. Fixed-layout
  // books never engage (D7); the indicator stays 'unsupported'.
  useEffect(() => {
    if (!paragraphConfig.enabled) return;
    if (isFixedLayout) return;

    const handlePlaybackState = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; state?: string } | undefined;
      if (detail?.bookKey !== bookKeyRef.current) return;
      const playing = detail.state === 'playing';
      ttsPlayingRef.current = playing;
      // A session exists while playing OR paused; only a full stop clears it.
      const active = detail.state === 'playing' || detail.state === 'paused';
      ttsActiveRef.current = active;
      setTtsActive(active);
      if (playing) {
        // Fresh engage (re-)enables following.
        followingTtsRef.current = true;
      }
      if (!active) {
        // Full stop: forget word-boundary state and clear the word highlight so a
        // later engine (which may lack word boundaries) starts clean.
        hasWordPositionsRef.current = false;
        eventDispatcher.dispatch('paragraph-tts-highlight', {
          bookKey: bookKeyRef.current,
          clear: true,
        });
      }
      refreshTtsSyncStatus();
    };

    const handlePosition = (event: CustomEvent) => {
      const detail = event.detail as
        | {
            bookKey?: string;
            cfi?: string;
            sectionIndex?: number;
            sequence?: number;
            kind?: 'word' | 'sentence';
          }
        | undefined;
      if (detail?.bookKey !== bookKeyRef.current) return;
      if (!followingTtsRef.current) return;
      if (typeof detail.cfi !== 'string' || typeof detail.sectionIndex !== 'number') return;

      // Drop out-of-order / stale events (dispatch awaits listeners serially and
      // callers fire-and-forget, so a slow map can land after a newer one).
      const sequence = detail.sequence ?? -Infinity;
      if (sequence <= lastSequenceSeenRef.current) return;
      lastSequenceSeenRef.current = sequence;

      // Word vs sentence highlight granularity (Edge emits both; words win once
      // seen). Paragraph selection still runs for 'skip' so following keeps up.
      const action = decideParagraphTtsHighlight({
        kind: detail.kind,
        hasWordPositions: hasWordPositionsRef.current,
      });
      if (detail.kind === 'word') hasWordPositionsRef.current = true;

      if (detail.sectionIndex === currentDocIndexRef.current) {
        applySyncCfi(detail.cfi, action !== 'skip');
        return;
      }

      // Different section: don't map. Stash the latest sync and invalidate the
      // current section so the existing relocate handler re-inits the iterator
      // for the new section; the pending sync is applied once re-init completes.
      pendingSyncRef.current = {
        cfi: detail.cfi,
        sequence,
        sectionIndex: detail.sectionIndex,
        kind: detail.kind,
      };
      iteratorRef.current = null;
      refreshTtsSyncStatus();
    };

    eventDispatcher.on('tts-playback-state', handlePlaybackState);
    eventDispatcher.on('tts-position', handlePosition);

    return () => {
      eventDispatcher.off('tts-playback-state', handlePlaybackState);
      eventDispatcher.off('tts-position', handlePosition);
    };
  }, [paragraphConfig.enabled, isFixedLayout, applySyncCfi, refreshTtsSyncStatus]);

  // Entering paragraph mode while a TTS session already exists: engage following
  // and ask useTTSControl to replay the current playback state + position so the
  // mode syncs to the spoken paragraph immediately, without the user having to
  // stop and restart TTS inside the mode. Declared after the follow-listener
  // effect so those handlers are registered (in effect-declaration order) before
  // the replayed events fire. No-op when no session exists (the request returns
  // early) or on fixed-layout (sync unsupported). Resetting lastSequenceSeen lets
  // the replayed position through even if a prior session left a higher sequence.
  useEffect(() => {
    if (!paragraphConfig.enabled || isFixedLayout) return;
    followingTtsRef.current = true;
    lastSequenceSeenRef.current = -Infinity;
    eventDispatcher.dispatch('tts-sync-request', { bookKey: bookKeyRef.current });
  }, [paragraphConfig.enabled, isFixedLayout]);

  useEffect(() => {
    return () => {
      if (focusResetTimerRef.current) {
        clearTimeout(focusResetTimerRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      iteratorRef.current = null;
      initPromiseRef.current = null;
    };
  }, []);

  return {
    paragraphState,
    ttsSyncStatus,
    ttsActive,
    paragraphConfig,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
    goToParagraph,
    toggleTtsAudio,
    reengageTtsFollow,
    focusCurrentParagraph,
    initIterator,
  };
};
