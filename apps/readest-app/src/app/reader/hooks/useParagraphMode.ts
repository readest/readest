import { useCallback, useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import { ParagraphIterator } from '@/utils/paragraph';
import { DEFAULT_PARAGRAPH_MODE_CONFIG } from '@/services/constants';

interface UseParagraphModeProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
}

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
  bookKeyRef.current = bookKey;

  const [paragraphState, setParagraphState] = useState<ParagraphState>({
    isActive: false,
    isLoading: false,
    currentIndex: -1,
    totalParagraphs: 0,
    currentRange: null,
  });

  const paragraphConfig = getViewSettings(bookKey)?.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;

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

        const contents = view.renderer.getContents();
        if (contents.length === 0) return false;

        const { doc, index: docIndex } = contents[0] ?? {};
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
            if (anchor instanceof Range) return anchor;
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
            if (anchor instanceof Range) return anchor;
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
        return true;
      } finally {
        isProcessingRef.current = false;
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = initPromise;
    return initPromise;
  }, [viewRef, getProgress, updateStateFromIterator]);

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
    isFocusingRef.current = true;
    const docIndex = currentDocIndexRef.current;
    const renderer = view.renderer as FoliateView['renderer'] & {
      goTo?: (target: { index: number; anchor: Range }) => Promise<void>;
    };
    if (docIndex !== undefined && renderer.goTo) {
      renderer.goTo({ index: docIndex, anchor: range });
    } else {
      view.renderer.scrollToAnchor(range);
    }
    focusResetTimerRef.current = setTimeout(() => {
      isFocusingRef.current = false;
    }, 200);

    eventDispatcher.dispatch('paragraph-focus', {
      bookKey: bookKeyRef.current,
      range,
      index: iterator.currentIndex,
      total: iterator.length,
    });
  }, [viewRef]);

  const waitForNewSection = useCallback(
    async (oldIndex: number | undefined, maxAttempts: number = 15): Promise<boolean> => {
      const view = viewRef.current;
      if (!view) return false;

      for (let i = 0; i < maxAttempts; i++) {
        const contents = view.renderer.getContents();
        if (contents.length > 0 && contents[0]?.doc && contents[0]?.index !== oldIndex) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 50 * (i + 1)));
      }
      return false;
    },
    [viewRef],
  );

  const goToNextParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

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
  }, [viewRef, updateStateFromIterator, focusCurrentParagraph, initIterator, waitForNewSection]);

  const goToPrevParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

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
  }, [viewRef, updateStateFromIterator, focusCurrentParagraph, initIterator, waitForNewSection]);

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
            view.renderer.scrollToAnchor(range);
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
    paragraphConfig,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
    goToParagraph,
    focusCurrentParagraph,
    initIterator,
  };
};
