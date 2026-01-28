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
  currentIndex: number;
  totalParagraphs: number;
  currentRange: Range | null;
}

export const useParagraphMode = ({ bookKey, viewRef }: UseParagraphModeProps) => {
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings, getProgress } = useReaderStore();

  const iteratorRef = useRef<ParagraphIterator | null>(null);
  const currentDocIndexRef = useRef<number | undefined>(undefined);
  const isInitializingRef = useRef(false);
  const bookKeyRef = useRef(bookKey);
  const pendingNavigationRef = useRef<'next' | 'prev' | null>(null);
  bookKeyRef.current = bookKey;

  const [paragraphState, setParagraphState] = useState<ParagraphState>({
    isActive: false,
    currentIndex: -1,
    totalParagraphs: 0,
    currentRange: null,
  });

  const getConfig = useCallback(() => {
    const settings = getViewSettings(bookKeyRef.current);
    return settings?.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
  }, [getViewSettings]);

  const paragraphConfig = getViewSettings(bookKey)?.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;

  const updateStateFromIterator = useCallback(() => {
    const iterator = iteratorRef.current;
    const config = getConfig();
    if (!iterator) {
      setParagraphState({
        isActive: config.enabled,
        currentIndex: -1,
        totalParagraphs: 0,
        currentRange: null,
      });
      return;
    }
    setParagraphState({
      isActive: config.enabled,
      currentIndex: iterator.currentIndex,
      totalParagraphs: iterator.length,
      currentRange: iterator.current(),
    });
  }, [getConfig]);

  const initIterator = useCallback(async (): Promise<boolean> => {
    if (isInitializingRef.current) return false;
    isInitializingRef.current = true;

    try {
      const view = viewRef.current;
      if (!view) return false;

      const contents = view.renderer.getContents();
      if (contents.length === 0) return false;

      const { doc, index: docIndex } = contents[0] ?? {};
      if (!doc) return false;

      currentDocIndexRef.current = docIndex;
      iteratorRef.current = new ParagraphIterator(doc);

      const pendingNav = pendingNavigationRef.current;
      pendingNavigationRef.current = null;

      if (pendingNav === 'next') {
        iteratorRef.current.first();
        updateStateFromIterator();
        return true;
      } else if (pendingNav === 'prev') {
        iteratorRef.current.last();
        updateStateFromIterator();
        return true;
      }

      const config = getConfig();
      const progress = getProgress(bookKeyRef.current);
      let found = false;

      if (config.paragraphLocation) {
        try {
          const { index, anchor } = view.resolveCFI(config.paragraphLocation);
          if (index === docIndex && iteratorRef.current) {
            const targetRange = anchor(doc);
            if (targetRange) {
              iteratorRef.current.findByRange(targetRange);
              found = true;
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!found && progress?.range && iteratorRef.current) {
        try {
          iteratorRef.current.findByRange(progress.range);
          found = true;
        } catch {
          /* ignore */
        }
      }

      if (!found && iteratorRef.current) {
        iteratorRef.current.first();
      }

      updateStateFromIterator();
      return true;
    } finally {
      isInitializingRef.current = false;
    }
  }, [viewRef, getConfig, getProgress, updateStateFromIterator]);

  const focusCurrentParagraph = useCallback(() => {
    const view = viewRef.current;
    const iterator = iteratorRef.current;
    if (!view || !iterator) return;

    const range = iterator.current();
    if (!range) return;

    view.renderer.scrollToAnchor(range);

    eventDispatcher.dispatch('paragraph-focus', {
      bookKey: bookKeyRef.current,
      range,
      index: iterator.currentIndex,
      total: iterator.length,
    });
  }, [viewRef]);

  const saveLocation = useCallback(() => {
    const view = viewRef.current;
    const iterator = iteratorRef.current;
    const docIndex = currentDocIndexRef.current;
    if (!view || !iterator || docIndex === undefined) return;

    const range = iterator.current();
    if (!range) return;

    try {
      const cfi = view.getCFI(docIndex, range);
      if (cfi) {
        const settings = getViewSettings(bookKeyRef.current);
        if (settings) {
          const currentConfig = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
          const newConfig = { ...currentConfig, paragraphLocation: cfi };
          setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
        }
      }
    } catch {
      /* ignore */
    }
  }, [viewRef, getViewSettings, setViewSettings]);

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
      saveLocation();
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
    saveLocation,
    initIterator,
    waitForNewSection,
  ]);

  const goToPrevParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

    const range = iterator.prev();
    if (range) {
      updateStateFromIterator();
      focusCurrentParagraph();
      saveLocation();
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
    saveLocation,
    initIterator,
    waitForNewSection,
  ]);

  const goToParagraph = useCallback(
    (index: number) => {
      const iterator = iteratorRef.current;
      if (!iterator) return false;

      const range = iterator.goTo(index);
      if (range) {
        updateStateFromIterator();
        focusCurrentParagraph();
        saveLocation();
        return true;
      }
      return false;
    },
    [updateStateFromIterator, focusCurrentParagraph, saveLocation],
  );

  const toggleParagraphMode = useCallback(async () => {
    const settings = getViewSettings(bookKeyRef.current);
    if (!settings) return;

    const currentConfig = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
    const newEnabled = !currentConfig.enabled;
    const newConfig = { ...currentConfig, enabled: newEnabled };

    setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
    saveViewSettings(envConfig, bookKeyRef.current, 'paragraphMode', newConfig, true, false);

    if (newEnabled) {
      const success = await initIterator();
      if (success) {
        focusCurrentParagraph();
      }
    } else {
      const view = viewRef.current;
      const iterator = iteratorRef.current;
      if (view && iterator) {
        const range = iterator.current();
        if (range) {
          view.renderer.scrollToAnchor(range);
        }
      }
      eventDispatcher.dispatch('paragraph-mode-disabled', { bookKey: bookKeyRef.current });
      iteratorRef.current = null;
      updateStateFromIterator();
    }
  }, [
    getViewSettings,
    setViewSettings,
    envConfig,
    initIterator,
    focusCurrentParagraph,
    viewRef,
    updateStateFromIterator,
  ]);

  // handle initial load if paragraph mode was already enabled
  useEffect(() => {
    if (paragraphConfig.enabled && !iteratorRef.current && !isInitializingRef.current) {
      const init = async () => {
        const success = await initIterator();
        if (success) {
          focusCurrentParagraph();
        }
      };
      const timer = setTimeout(init, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphConfig.enabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const handleRelocate = async () => {
      const config = getConfig();
      if (
        config.enabled &&
        !isInitializingRef.current &&
        !pendingNavigationRef.current &&
        !iteratorRef.current
      ) {
        await new Promise((r) => setTimeout(r, 200));
        const success = await initIterator();
        if (success) {
          focusCurrentParagraph();
        }
      }
    };

    view.renderer.addEventListener('relocate', handleRelocate);
    return () => {
      view.renderer.removeEventListener('relocate', handleRelocate);
    };
  }, [viewRef, getConfig, initIterator, focusCurrentParagraph]);

  useEffect(() => {
    const handleToggle = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current) {
        toggleParagraphMode();
      }
    };

    const handleNext = (event: CustomEvent) => {
      const config = getConfig();
      if (event.detail?.bookKey === bookKeyRef.current && config.enabled) {
        goToNextParagraph();
      }
    };

    const handlePrev = (event: CustomEvent) => {
      const config = getConfig();
      if (event.detail?.bookKey === bookKeyRef.current && config.enabled) {
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
  }, [toggleParagraphMode, goToNextParagraph, goToPrevParagraph, getConfig]);

  useEffect(() => {
    return () => {
      iteratorRef.current = null;
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
