import { useEffect, useRef } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import {
  AudiobookConfig,
  AudiobookSyncPoint,
  AudiobookTextUnit,
  AudiobookTranscriptSegment,
} from '@/types/book';
import { buildSyncMapFromPoints, normalizeAudiobookSyncPoints } from '@/utils/audiobookSync';
import {
  matchTranscriptSegmentsToTextUnits,
  normalizeAudiobookMatchText,
  parseAudiobookTranscript,
} from '@/utils/audiobookTranscript';
import { useAudiobookSync } from './useAudiobookSync';

/** Dev-only console API exposed on window.__citadelAudiobookSync */
export interface CitadelAudiobookSyncDebugApi {
  capturePoint(label?: string): void;
  listPoints(): AudiobookSyncPoint[];
  clearPoints(): void;
  removePoint(index: number): void;
  /** Generate sync map from transcript text matched against loaded EPUB sections */
  generateSyncMapFromTranscriptText(
    transcriptText: string,
  ): Promise<{ matched: number; total: number }>;
  /** Preview transcript matches without persisting (returns match details) */
  previewTranscriptMatches(
    transcriptText: string,
  ): { secondsStart: number; label: string; cfi: string; score: number }[];
}

const DEDUP_THRESHOLD_SEC = 0.5;

function isDev(): boolean {
  return process.env['NODE_ENV'] === 'development';
}

/**
 * Extracts AudiobookTextUnit[] from the currently loaded EPUB sections.
 * Collects block-level elements (p, h1-h6, li, blockquote, div with text),
 * creates a Range for each, and resolves a CFI via view.getCFI().
 *
 * Only covers currently visible/nearby sections (what the renderer has loaded).
 * This is sufficient for Stage 5A; whole-spine extraction can be added later.
 */
function extractTextUnitsFromView(view: {
  renderer: { getContents(): { doc: Document; index?: number }[] };
  getCFI(index: number, range: Range): string;
}): AudiobookTextUnit[] {
  const units: AudiobookTextUnit[] = [];
  const blockSelectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt';

  const contents = view.renderer?.getContents?.() ?? [];
  for (const content of contents) {
    const doc = content.doc as Document | undefined;
    const index = content.index ?? 0;
    if (!doc) continue;

    const blocks = doc.querySelectorAll(blockSelectors);
    for (const block of blocks) {
      const el = block as HTMLElement;
      const text = el.textContent?.trim() ?? '';
      if (text.length < 3) continue;

      try {
        const range = doc.createRange();
        range.selectNodeContents(el);
        const cfi = view.getCFI(index, range);
        if (cfi) {
          units.push({ cfi, text, sectionIndex: index });
        }
      } catch {
        // Skip blocks where CFI resolution fails
      }
    }
  }

  return units;
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

      async generateSyncMapFromTranscriptText(
        transcriptText: string,
      ): Promise<{ matched: number; total: number }> {
        const config = getConfig(bookKey);
        const audiobook = config?.audiobook;
        if (!audiobook) {
          console.warn('[AudiobookSyncDebug] No audiobook attached.');
          return { matched: 0, total: 0 };
        }

        // --- Parse transcript -----------------------------------------------
        const segments: AudiobookTranscriptSegment[] = parseAudiobookTranscript(transcriptText);
        if (segments.length === 0) {
          console.warn('[AudiobookSyncDebug] No valid transcript segments found.');
          return { matched: 0, total: 0 };
        }

        // --- Extract text units from loaded EPUB sections --------------------
        const view = getView(bookKey);
        if (!view) {
          console.warn(
            '[AudiobookSyncDebug] No view available — text unit extraction not possible yet.',
          );
          return { matched: 0, total: segments.length };
        }

        const textUnits = extractTextUnitsFromView(view);
        if (textUnits.length === 0) {
          console.warn(
            '[AudiobookSyncDebug] No text units extracted from loaded sections. Try scrolling through the book first.',
          );
          return { matched: 0, total: segments.length };
        }

        console.info('[AudiobookSyncDebug] Extracted text units', {
          count: textUnits.length,
          sections: new Set(textUnits.map((u) => u.sectionIndex)).size,
        });

        // --- Match transcript segments to text units -------------------------
        const syncMap = matchTranscriptSegmentsToTextUnits(segments, textUnits, {
          minSegmentLength: 5,
        });

        if (syncMap.length === 0) {
          console.warn(
            '[AudiobookSyncDebug] No transcript segments could be matched to EPUB text.',
          );
          return { matched: 0, total: segments.length };
        }

        // --- Persist: merge with existing, preserve manual sync points -------
        const updatedAudiobook: AudiobookConfig = {
          ...audiobook,
          syncMap,
          syncStatus: 'ready',
          transcriptStatus: 'ready',
        };

        try {
          setConfig(bookKey, { audiobook: updatedAudiobook, updatedAt: Date.now() });
        } catch (err) {
          console.error('[AudiobookSyncDebug] Failed to save transcript sync map', err);
          return { matched: syncMap.length, total: segments.length };
        }

        console.info('[AudiobookSyncDebug] Generated sync map from transcript', {
          totalSegments: segments.length,
          matchedEntries: syncMap.length,
        });

        return { matched: syncMap.length, total: segments.length };
      },

      previewTranscriptMatches(transcriptText: string) {
        const segments = parseAudiobookTranscript(transcriptText);
        if (segments.length === 0) return [];

        const view = getView(bookKey);
        if (!view) {
          console.warn('[AudiobookSyncDebug] No view available for preview.');
          return [];
        }

        const textUnits = extractTextUnitsFromView(view);
        if (textUnits.length === 0) return [];

        // Run matching and return preview with scores
        const normUnits = textUnits.map((u) => ({
          unit: u,
          norm: normalizeAudiobookMatchText(u.text),
        }));

        const MATCH_THRESHOLD = 0.4;
        const results: { secondsStart: number; label: string; cfi: string; score: number }[] = [];

        for (const seg of segments) {
          if (seg.text.trim().length < 5) continue;

          const normSeg = normalizeAudiobookMatchText(seg.text);
          let bestCfi = '';
          let bestScore = 0;

          for (const { unit, norm } of normUnits) {
            if (norm.length === 0) continue;

            let score = 0;
            if (norm.includes(normSeg)) {
              score = 1;
            } else if (normSeg.includes(norm)) {
              score = norm.length / normSeg.length;
            } else {
              // Token overlap
              const tokensA = normSeg.split(' ').filter(Boolean);
              const tokensB = norm.split(' ').filter(Boolean);
              const [shorter, longer] =
                tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
              const longerSet = new Set(longer);
              let overlap = 0;
              for (const token of shorter) {
                if (longerSet.has(token)) overlap++;
              }
              score = shorter.length > 0 ? overlap / shorter.length : 0;
            }

            if (score > bestScore) {
              bestScore = score;
              bestCfi = unit.cfi;
            }
          }

          results.push({
            secondsStart: seg.start,
            label: seg.text.trim().slice(0, 60),
            cfi: bestScore >= MATCH_THRESHOLD ? bestCfi : '',
            score: Math.round(bestScore * 100) / 100,
          });
        }

        return results;
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
