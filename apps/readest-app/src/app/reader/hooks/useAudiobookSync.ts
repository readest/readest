import { useCallback, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { applyLiveMarker, clearLiveMarker } from '@/utils/liveMarker';

interface UseAudiobookSyncProps {
  bookKey: string;
}

const RELOCATION_DEBOUNCE_MS = 1500;

/**
 * Applies an audiobook sync marker for the given CFI.  When the CFI belongs
 * to a section that is not currently visible the hook navigates to it
 * (debounced so rapid time-updates don't cause excessive page turns).
 *
 * This is the pure marker consumer wired to the sync-map provider in
 * useAudiobookPlayer.
 */
export const useAudiobookSync = ({ bookKey }: UseAudiobookSyncProps) => {
  const { getView, getViewSettings } = useReaderStore();
  const lastRelocationRef = useRef<{ time: number; sectionIndex: number } | null>(null);

  const applyAudiobookMarker = useCallback(
    (cfi: string) => {
      const view = getView(bookKey);
      const viewSettings = getViewSettings(bookKey);
      if (!view || !viewSettings) return;

      const result = applyLiveMarker(view, cfi, viewSettings.ttsHighlightOptions, {
        showHeader: viewSettings.showHeader,
        showFooter: viewSettings.showFooter,
        showBarsOnScroll: viewSettings.showBarsOnScroll,
        scrollingOverlap: viewSettings.scrollingOverlap,
      });

      if (result.status === 'wrong-section') {
        const now = Date.now();
        const prev = lastRelocationRef.current;
        // Debounce: skip if we recently navigated to the same section
        if (
          prev &&
          prev.sectionIndex === result.cfiSectionIndex &&
          now - prev.time < RELOCATION_DEBOUNCE_MS
        ) {
          return;
        }

        const section = view.book.sections[result.cfiSectionIndex];
        if (section?.href) {
          lastRelocationRef.current = { time: now, sectionIndex: result.cfiSectionIndex };
          try {
            view.goTo(section.href);
          } catch {
            // navigation may fail if section isn't ready — next timeupdate
            // will retry
          }
        }
      }
    },
    [bookKey, getView, getViewSettings],
  );

  const clearAudiobookMarker = useCallback(() => {
    const view = getView(bookKey);
    if (!view) return;
    clearLiveMarker(view);
  }, [bookKey, getView]);

  return { applyAudiobookMarker, clearAudiobookMarker };
};
