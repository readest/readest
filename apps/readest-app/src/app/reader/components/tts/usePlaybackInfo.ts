import { useCallback, useEffect, useRef, useState } from 'react';
import { eventDispatcher } from '@/utils/event';

export type TTSPlaybackInfo = {
  position: number;
  duration: number;
  measuredFraction: number;
};

// Suppress poll updates briefly after a seek so the optimistic thumb never
// snaps back while the cold-seek fetch completes.
const SEEK_SUPPRESS_MS = 2000;
// Small backward drifts come from estimate refinement, not playback — hold the
// displayed position monotonic; larger jumps are deliberate (seek, chapter).
const MONOTONIC_SLACK_SEC = 3;

type UsePlaybackInfoOptions = {
  bookKey: string;
  isEink: boolean;
  onGetPlaybackInfo: () => TTSPlaybackInfo | null;
};

export const usePlaybackInfo = ({ bookKey, isEink, onGetPlaybackInfo }: UsePlaybackInfoOptions) => {
  const [info, setInfo] = useState<TTSPlaybackInfo | null>(null);
  const [stale, setStale] = useState(true);
  const [displayTotal, setDisplayTotal] = useState<number | null>(null);
  const pausedRef = useRef(false);
  const suppressUntilRef = useRef(0);
  const lastPositionRef = useRef(0);

  const refresh = useCallback(() => {
    if (pausedRef.current) return;
    if (Date.now() < suppressUntilRef.current) return;
    const next = onGetPlaybackInfo();
    if (!next) {
      // Keep the last-known values rendered (stale) across chapter
      // transitions and while the lazy timeline builds — no row blink.
      setStale(true);
      return;
    }
    let position = next.position;
    if (
      position < lastPositionRef.current &&
      lastPositionRef.current - position < MONOTONIC_SLACK_SEC
    ) {
      position = lastPositionRef.current;
    }
    lastPositionRef.current = position;
    setInfo({ ...next, position });
    setStale(false);
    // Quantize the displayed total: only follow estimate drift when it moves
    // by more than 2%, so the chapter length reads stable, not twitchy.
    setDisplayTotal((prev) =>
      prev === null || Math.abs(next.duration - prev) / prev > 0.02 ? next.duration : prev,
    );
  }, [onGetPlaybackInfo]);

  useEffect(() => {
    refresh();
    if (isEink) {
      // No 1s repaints on e-ink: follow sentence-level position events only.
      const handler = (event: CustomEvent) => {
        const detail = event.detail as { bookKey?: string; kind?: string };
        if (detail.bookKey === bookKey && detail.kind === 'sentence') refresh();
      };
      eventDispatcher.on('tts-position', handler);
      return () => eventDispatcher.off('tts-position', handler);
    }
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh, isEink, bookKey]);

  const setRefreshPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  // Optimistic seek: land on the target immediately and hold it while the
  // seek resolves. Returns a rollback for the failure path so a silent
  // snap-back never happens — the caller restores visibly and says why.
  const applySeek = useCallback((seconds: number) => {
    const previous = lastPositionRef.current;
    suppressUntilRef.current = Date.now() + SEEK_SUPPRESS_MS;
    lastPositionRef.current = seconds;
    setInfo((prev) => (prev ? { ...prev, position: seconds } : prev));
    return () => {
      suppressUntilRef.current = 0;
      lastPositionRef.current = previous;
      setInfo((prev) => (prev ? { ...prev, position: previous } : prev));
    };
  }, []);

  const total = displayTotal ?? info?.duration ?? 0;
  return {
    ready: info !== null && total > 0,
    stale,
    position: info?.position ?? 0,
    total,
    measuredFraction: info?.measuredFraction ?? 0,
    setRefreshPaused,
    applySeek,
  };
};
