import { useCallback } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { applyLiveMarker, clearLiveMarker } from '@/utils/liveMarker';

interface UseAudiobookSyncProps {
  bookKey: string;
}

/**
 * Placeholder hook for future audiobook time→text sync.
 *
 * When a time→CFI mapping becomes available, call applyAudiobookMarker(cfi)
 * and it will highlight and scroll to the matching text using the same
 * live-marker pipeline as TTS.  clearAudiobookMarker() removes the highlight.
 *
 * Nothing here touches TTS or audiobook playback — it is a pure marker
 * consumer that will be wired to a sync-map provider in a later pass.
 */
export const useAudiobookSync = ({ bookKey }: UseAudiobookSyncProps) => {
  const { getView, getViewSettings } = useReaderStore();

  const applyAudiobookMarker = useCallback(
    (cfi: string) => {
      const view = getView(bookKey);
      const viewSettings = getViewSettings(bookKey);
      if (!view || !viewSettings) return;

      applyLiveMarker(view, cfi, viewSettings.ttsHighlightOptions, {
        showHeader: viewSettings.showHeader,
        showFooter: viewSettings.showFooter,
        showBarsOnScroll: viewSettings.showBarsOnScroll,
        scrollingOverlap: viewSettings.scrollingOverlap,
      });
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
