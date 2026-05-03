import { useEffect, useRef } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { AudiobookConfig, AudiobookSyncPoint } from '@/types/book';
import { buildSyncMapFromPoints, normalizeAudiobookSyncPoints } from '@/utils/audiobookSync';
import { useAudiobookSync } from './useAudiobookSync';

/** Dev-only console API exposed on window.__citadelAudiobookSync */
export interface CitadelAudiobookSyncDebugApi {
  capturePoint(label?: string): void;
  listPoints(): AudiobookSyncPoint[];
  clearPoints(): void;
  removePoint(index: number): void;
}

const DEDUP_THRESHOLD_SEC = 0.5;

function isDev(): boolean {
  return process.env['NODE_ENV'] === 'development';
}

/**
 * Rebuilds the syncMap from syncPoints and returns an updated AudiobookConfig.
 */
function rebuildConfigWithSyncMap(audiobook: AudiobookConfig): AudiobookConfig {
  const syncMap = buildSyncMapFromPoints(audiobook.syncPoints, { duration: audiobook.duration });
  return {
    ...audiobook,
    syncMap,
    syncStatus: syncMap.length > 0 ? 'ready' : 'none',
  };
}

/**
 * Dev-only hook that installs `window.__citadelAudiobookSync` while the reader
 * is mounted and an audiobook is attached.  Removes the API on unmount / book
 * change so it never leaks into production builds at runtime.
 */
export const useAudiobookSyncDebug = (props: {
  bookKey: string;
  currentTime: number;
  isLoaded: boolean;
}) => {
  const { bookKey, currentTime, isLoaded } = props;
  const { getConfig, setConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const { applyAudiobookMarker } = useAudiobookSync({ bookKey });

  // Keep a ref to currentTime so the closure always sees the latest value
  const currentTimeRef = useRef(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!isDev()) return;

    const api: CitadelAudiobookSyncDebugApi = {
      capturePoint(label?: string) {
        const config = getConfig(bookKey);
        const audiobook = config?.audiobook;
        if (!audiobook) {
          console.warn('[AudiobookSyncDebug] No audiobook attached — nothing to capture.');
          return;
        }
        if (!isLoaded) {
          console.warn('[AudiobookSyncDebug] Audiobook not loaded yet.');
          return;
        }

        const time = currentTimeRef.current;

        // --- Resolve CFI ---------------------------------------------------
        let cfi: string | null = null;
        let textPreview = '';

        const view = getView(bookKey);
        if (view) {
          // Try selected text range across all rendered sections
          const contents = view.renderer?.getContents?.() ?? [];
          for (const content of contents) {
            const doc = content.doc as Document | undefined;
            const index = content.index ?? 0;
            if (!doc) continue;
            const sel = doc.getSelection?.();
            if (sel && sel.toString().trim().length > 0 && sel.rangeCount > 0) {
              try {
                const range = sel.getRangeAt(0);
                cfi = view.getCFI(index, range);
                textPreview = sel.toString().trim().slice(0, 60);
              } catch (err) {
                console.warn('[AudiobookSyncDebug] getCFI from selection failed', err);
              }
              break;
            }
          }
        }

        // Fallback: current reader location CFI
        if (!cfi) {
          const progress = getProgress(bookKey);
          if (progress?.location) {
            cfi = progress.location;
            textPreview = '(current location)';
          }
        }

        if (!cfi) {
          console.warn(
            '[AudiobookSyncDebug] No selected text range or current location CFI available.',
          );
          return;
        }

        // --- Build sync point ----------------------------------------------
        const point: AudiobookSyncPoint = {
          time,
          cfi,
          label: label ?? (textPreview || `t=${time.toFixed(1)}`),
          createdAt: Date.now(),
        };

        // --- Merge into syncPoints (sorted, de-duped by time proximity) -----
        const existingPoints: AudiobookSyncPoint[] = audiobook.syncPoints
          ? [...audiobook.syncPoints]
          : [];

        const dedupIdx = existingPoints.findIndex(
          (p) => Math.abs(p.time - point.time) < DEDUP_THRESHOLD_SEC,
        );
        if (dedupIdx !== -1) {
          existingPoints[dedupIdx] = point;
        } else {
          existingPoints.push(point);
        }

        // --- Rebuild syncMap from all points --------------------------------
        const updatedAudiobook: AudiobookConfig = {
          ...audiobook,
          syncPoints: existingPoints,
        };
        const withSyncMap = rebuildConfigWithSyncMap(updatedAudiobook);

        // --- Persist -------------------------------------------------------
        try {
          setConfig(bookKey, { audiobook: withSyncMap, updatedAt: Date.now() });
        } catch (err) {
          console.error('[AudiobookSyncDebug] Failed to save syncPoints/syncMap', err);
          return;
        }

        // --- Apply marker immediately so dev sees it -----------------------
        try {
          applyAudiobookMarker(cfi);
        } catch (err) {
          console.warn('[AudiobookSyncDebug] applyAudiobookMarker failed', err);
        }

        console.info('[AudiobookSyncDebug] Captured sync point', {
          time: point.time,
          cfi: point.cfi,
          label: point.label,
          pointsCount: existingPoints.length,
          mapEntries: withSyncMap.syncMap?.length ?? 0,
        });
      },

      listPoints() {
        const config = getConfig(bookKey);
        return normalizeAudiobookSyncPoints(config?.audiobook?.syncPoints);
      },

      clearPoints() {
        const config = getConfig(bookKey);
        const audiobook = config?.audiobook;
        if (!audiobook) {
          console.warn('[AudiobookSyncDebug] No audiobook attached.');
          return;
        }
        setConfig(bookKey, {
          audiobook: { ...audiobook, syncPoints: [], syncMap: [], syncStatus: 'none' },
          updatedAt: Date.now(),
        });
        console.info('[AudiobookSyncDebug] Cleared all sync points and sync map.');
      },

      removePoint(index: number) {
        const config = getConfig(bookKey);
        const audiobook = config?.audiobook;
        if (!audiobook) {
          console.warn('[AudiobookSyncDebug] No audiobook attached.');
          return;
        }
        const points = normalizeAudiobookSyncPoints(audiobook.syncPoints);
        if (index < 0 || index >= points.length) {
          console.warn(
            `[AudiobookSyncDebug] Index ${index} out of range (0..${points.length - 1}).`,
          );
          return;
        }
        const removed = points.splice(index, 1)[0];

        const updatedAudiobook: AudiobookConfig = {
          ...audiobook,
          syncPoints: points,
        };
        const withSyncMap = rebuildConfigWithSyncMap(updatedAudiobook);

        setConfig(bookKey, { audiobook: withSyncMap, updatedAt: Date.now() });
        console.info('[AudiobookSyncDebug] Removed point', { index, removed });
      },
    };

    (window as unknown as Record<string, unknown>)['__citadelAudiobookSync'] = api;
    console.info(
      '[AudiobookSyncDebug] Dev API installed: window.__citadelAudiobookSync',
      Object.keys(api),
    );

    return () => {
      delete (window as unknown as Record<string, unknown>)['__citadelAudiobookSync'];
    };
  }, [bookKey, isLoaded, getConfig, setConfig, getView, getProgress, applyAudiobookMarker]);
};
