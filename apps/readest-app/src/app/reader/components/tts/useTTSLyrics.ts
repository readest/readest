import { useCallback, useEffect, useRef, useState } from 'react';
import { eventDispatcher } from '@/utils/event';

export type TTSLyrics = { sectionIndex: number; lines: string[] };

// The spoken line moves on sentence boundaries and 'tts-position' delivers
// those, so this poll is only a backstop for a position event missed while the
// sheet was closed. The setter bails on an unchanged value, so a quiet session
// re-renders nothing — which is what keeps this affordable on e-ink.
const STATE_POLL_MS = 500;

// The lyric view renders the whole section so its scroll geometry is measured
// rather than estimated. A chapter is the natural unit for that; a whole book
// imported as one section is not, and past this the player keeps its cover.
export const LYRIC_MAX_LINES = 2000;

// Stable identity: the view re-measures its whole scroll geometry whenever the
// line array changes, and a fresh [] every render would do that forever.
const NO_LINES: string[] = [];

type UseTTSLyricsOptions = {
  bookKey: string;
  // False for engines with no sentence alignment: nothing is fetched or polled.
  enabled: boolean;
  onGetLyrics: () => Promise<TTSLyrics | null>;
  onGetActiveIndex: () => number;
};

// Section transcript + live position for the Read Aloud lyric view (#5755).
// `unavailable` stays false until a load actually comes back empty (or too
// long), so the player commits to the lyric layout up front and only falls
// back to the cover for the sections that genuinely have no sheet to show.
export const useTTSLyrics = ({
  bookKey,
  enabled,
  onGetLyrics,
  onGetActiveIndex,
}: UseTTSLyricsOptions) => {
  const [lyrics, setLyrics] = useState<TTSLyrics | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const loadingRef = useRef(false);

  const loadLyrics = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await onGetLyrics();
      const usable = !!next && next.lines.length > 0 && next.lines.length <= LYRIC_MAX_LINES;
      setUnavailable(!usable);
      setLyrics((prev) =>
        // Identity matters: a new array re-measures the whole list.
        prev &&
        next &&
        prev.sectionIndex === next.sectionIndex &&
        prev.lines.length === next.lines.length
          ? prev
          : usable
            ? next
            : null,
      );
    } catch {
      // A transcript that cannot be read is a section with no sheet to show:
      // fall back to the cover rather than leaving the lyric layout standing
      // over nothing (and leaving the rejection unhandled).
      setUnavailable(true);
      setLyrics(null);
    } finally {
      loadingRef.current = false;
    }
  }, [onGetLyrics]);

  useEffect(() => {
    if (!enabled) return;
    void loadLyrics();
  }, [enabled, loadLyrics]);

  const refreshState = useCallback(() => {
    const next = onGetActiveIndex();
    setActiveIndex((prev) => (prev === next ? prev : next));
  }, [onGetActiveIndex]);

  const sectionIndex = lyrics?.sectionIndex;
  useEffect(() => {
    if (!enabled) return;
    refreshState();
    const handler = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; sectionIndex?: number };
      if (detail.bookKey !== bookKey) return;
      refreshState();
      // A chapter change is the only thing that replaces the sheet, and the
      // position event is the first place it shows up.
      if (detail.sectionIndex !== undefined && detail.sectionIndex !== sectionIndex) {
        void loadLyrics();
      }
    };
    eventDispatcher.on('tts-position', handler);
    const interval = setInterval(refreshState, STATE_POLL_MS);
    return () => {
      eventDispatcher.off('tts-position', handler);
      clearInterval(interval);
    };
  }, [bookKey, enabled, refreshState, loadLyrics, sectionIndex]);

  return { lines: lyrics?.lines ?? NO_LINES, unavailable, activeIndex };
};
