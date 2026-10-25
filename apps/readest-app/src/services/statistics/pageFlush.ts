/**
 * Readers currently timing a page. The statistics dialog flushes them before
 * querying, so the page on screen reaches the database with its real duration
 * instead of waiting for the next page turn or the idle timeout.
 */
type PageFlusher = () => Promise<void>;

const flushers = new Set<PageFlusher>();

/** Register a tracker's page flusher; returns the unregister callback. */
export const registerPageFlusher = (flusher: PageFlusher): (() => void) => {
  flushers.add(flusher);
  return () => {
    flushers.delete(flusher);
  };
};

/** Flush every open reader (single view or split view) before reading stats. */
export const flushPageStats = async (): Promise<void> => {
  await Promise.allSettled([...flushers].map((flush) => flush()));
};
