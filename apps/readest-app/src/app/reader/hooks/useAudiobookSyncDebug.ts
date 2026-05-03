import { useEffect, useRef } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import {
  AudiobookConfig,
  AudiobookSyncPoint,
  AudiobookTextUnit,
  AudiobookTranscriptSegment,
} from '@/types/book';
import { buildSyncMapFromPoints, normalizeAudiobookSyncPoints } from '@/utils/audiobookSync';
import {
  matchTranscriptSegmentsToTextUnitsWithDiagnostics,
  parseAudiobookTranscript,
  type MatchDiagnostics,
} from '@/utils/audiobookTranscript';
import {
  extractTextUnitsFromWholeBook,
  extractTextUnitsFromVisibleSections,
} from '@/utils/transcriptSync';
import { useAudiobookSync } from './useAudiobookSync';

/** Dev-only console API exposed on window.__citadelAudiobookSync */
export interface CitadelAudiobookSyncDebugApi {
  capturePoint(label?: string): void;
  listPoints(): AudiobookSyncPoint[];
  clearPoints(): void;
  removePoint(index: number): void;
  /** Generate sync map from transcript text matched against whole-book EPUB text */
  generateSyncMapFromTranscriptText(
    transcriptText: string,
  ): Promise<{ matched: number; total: number }>;
  /** Preview transcript matches without persisting (returns match details) */
  previewTranscriptMatches(
    transcriptText: string,
  ): Promise<{ secondsStart: number; label: string; cfi: string; score: number }[]>;
  /** Read attached transcript file, parse, extract whole-book text, generate sync map */
  generateSyncMapFromAttachedTranscript(): Promise<{
    matched: number;
    total: number;
    error?: string;
  }>;
  /** Preview transcript diagnostics without persisting */
  previewTranscriptDiagnostics(transcriptText: string): Promise<MatchDiagnostics>;
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
  const { appService } = useEnv();
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

        // --- Extract text units (whole-book preferred, visible fallback) -----
        const view = getView(bookKey);
        if (!view) {
          console.warn(
            '[AudiobookSyncDebug] No view available — text unit extraction not possible.',
          );
          return { matched: 0, total: segments.length };
        }

        let textUnits: AudiobookTextUnit[];
        let usedFallback = false;

        // Try whole-book extraction first
        try {
          const result = await extractTextUnitsFromWholeBook(view);
          console.info('[AudiobookSyncDebug] Whole-book extraction', {
            sectionsScanned: result.sectionsScanned,
            sectionsSkipped: result.sectionsSkipped,
            textUnits: result.units.length,
          });
          textUnits = result.units;
        } catch (err) {
          console.warn('[AudiobookSyncDebug] Whole-book extraction failed, using fallback.', err);
          textUnits = [];
        }

        // Fallback to visible sections if whole-book returned nothing
        if (textUnits.length === 0) {
          textUnits = extractTextUnitsFromVisibleSections(view);
          usedFallback = true;
          if (textUnits.length > 0) {
            console.info('[AudiobookSyncDebug] Using visible-section fallback', {
              textUnits: textUnits.length,
            });
          }
        }

        if (textUnits.length === 0) {
          console.warn('[AudiobookSyncDebug] No text units extracted from any source.');
          return { matched: 0, total: segments.length };
        }

        // --- Match transcript segments to text units -------------------------
        const { entries: syncMap, diagnostics } = matchTranscriptSegmentsToTextUnitsWithDiagnostics(
          segments,
          textUnits,
          { minSegmentLength: 5 },
        );

        console.info('[AudiobookSyncDebug] Matching diagnostics', diagnostics);

        if (syncMap.length === 0) {
          console.warn(
            '[AudiobookSyncDebug] No transcript segments could be matched to EPUB text.',
          );
          return { matched: 0, total: segments.length };
        }

        // --- Persist --------------------------------------------------------
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
          usedFallback,
          avgScore: diagnostics.averageScore,
          lowConfidence: diagnostics.lowConfidenceCount,
        });

        return { matched: syncMap.length, total: segments.length };
      },

      async previewTranscriptMatches(transcriptText: string) {
        const segments = parseAudiobookTranscript(transcriptText);
        if (segments.length === 0) return [];

        const view = getView(bookKey);
        if (!view) {
          console.warn('[AudiobookSyncDebug] No view available for preview.');
          return [];
        }

        // Try whole-book extraction, fallback to visible
        let textUnits: AudiobookTextUnit[];
        try {
          const result = await extractTextUnitsFromWholeBook(view);
          textUnits = result.units;
        } catch {
          textUnits = [];
        }
        if (textUnits.length === 0) {
          textUnits = extractTextUnitsFromVisibleSections(view);
        }
        if (textUnits.length === 0) return [];

        // Use centralized matching with diagnostics
        const { entries, diagnostics } = matchTranscriptSegmentsToTextUnitsWithDiagnostics(
          segments,
          textUnits,
          { minSegmentLength: 5 },
        );

        console.info('[AudiobookSyncDebug] Preview diagnostics', diagnostics);

        return entries.map((e) => ({
          secondsStart: e.secondsStart,
          label: e.label ?? '',
          cfi: e.cfi,
          score: e.matchScore ?? 0,
        }));
      },

      async generateSyncMapFromAttachedTranscript(): Promise<{
        matched: number;
        total: number;
        error?: string;
      }> {
        const config = getConfig(bookKey);
        const audiobook = config?.audiobook;
        if (!audiobook) {
          return { matched: 0, total: 0, error: 'No audiobook attached' };
        }
        if (!audiobook.transcriptPath) {
          return { matched: 0, total: 0, error: 'No transcript file attached' };
        }

        // --- Read transcript file -------------------------------------------
        let transcriptText: string;
        try {
          const content = await appService?.readFile(
            audiobook.transcriptPath,
            'None' as import('@/types/system').BaseDir,
            'text',
          );
          if (typeof content !== 'string') {
            return { matched: 0, total: 0, error: 'Transcript file returned binary data' };
          }
          transcriptText = content;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to read transcript file';
          console.warn('[AudiobookSyncDebug] Failed to read transcript file', err);
          return { matched: 0, total: 0, error: msg };
        }

        // --- Parse transcript -----------------------------------------------
        const segments: AudiobookTranscriptSegment[] = parseAudiobookTranscript(transcriptText);
        if (segments.length === 0) {
          return { matched: 0, total: 0, error: 'No valid transcript segments found in file' };
        }

        // --- Extract text units (whole-book preferred, visible fallback) -----
        const view = getView(bookKey);
        if (!view) {
          return { matched: 0, total: segments.length, error: 'No view available' };
        }

        let textUnits: AudiobookTextUnit[];
        let usedFallback = false;

        try {
          const result = await extractTextUnitsFromWholeBook(view);
          console.info('[AudiobookSyncDebug] Whole-book extraction', {
            sectionsScanned: result.sectionsScanned,
            sectionsSkipped: result.sectionsSkipped,
            textUnits: result.units.length,
          });
          textUnits = result.units;
        } catch (err) {
          console.warn('[AudiobookSyncDebug] Whole-book extraction failed, using fallback.', err);
          textUnits = [];
        }

        if (textUnits.length === 0) {
          textUnits = extractTextUnitsFromVisibleSections(view);
          usedFallback = true;
        }

        if (textUnits.length === 0) {
          return { matched: 0, total: segments.length, error: 'No text units extracted' };
        }

        // --- Match transcript segments to text units -------------------------
        const { entries: syncMap, diagnostics } = matchTranscriptSegmentsToTextUnitsWithDiagnostics(
          segments,
          textUnits,
          { minSegmentLength: 5 },
        );

        console.info('[AudiobookSyncDebug] Attached transcript matching diagnostics', diagnostics);

        if (syncMap.length === 0) {
          return { matched: 0, total: segments.length, error: 'No segments matched to EPUB text' };
        }

        // --- Persist --------------------------------------------------------
        const updatedAudiobook: AudiobookConfig = {
          ...audiobook,
          syncMap,
          syncStatus: 'ready',
          transcriptStatus: 'ready',
        };

        try {
          setConfig(bookKey, { audiobook: updatedAudiobook, updatedAt: Date.now() });
        } catch (err) {
          console.error('[AudiobookSyncDebug] Failed to save sync map', err);
        }

        console.info('[AudiobookSyncDebug] Generated sync map from attached transcript', {
          totalSegments: segments.length,
          matchedEntries: syncMap.length,
          usedFallback,
          transcriptFile: audiobook.transcriptFileName,
          avgScore: diagnostics.averageScore,
          lowConfidence: diagnostics.lowConfidenceCount,
        });

        return { matched: syncMap.length, total: segments.length };
      },

      async previewTranscriptDiagnostics(transcriptText: string): Promise<MatchDiagnostics> {
        const segments = parseAudiobookTranscript(transcriptText);
        if (segments.length === 0) {
          return {
            totalSegments: 0,
            matchedCount: 0,
            skippedCount: 0,
            lowConfidenceCount: 0,
            averageScore: 0,
            sectionDistribution: {},
            topSkipped: [],
            topLowConfidence: [],
          };
        }

        const view = getView(bookKey);
        if (!view) {
          console.warn('[AudiobookSyncDebug] No view available for diagnostics.');
          return {
            totalSegments: segments.length,
            matchedCount: 0,
            skippedCount: segments.length,
            lowConfidenceCount: 0,
            averageScore: 0,
            sectionDistribution: {},
            topSkipped: [],
            topLowConfidence: [],
          };
        }

        let textUnits: AudiobookTextUnit[];
        try {
          const result = await extractTextUnitsFromWholeBook(view);
          textUnits = result.units;
        } catch {
          textUnits = [];
        }
        if (textUnits.length === 0) {
          textUnits = extractTextUnitsFromVisibleSections(view);
        }

        const { diagnostics } = matchTranscriptSegmentsToTextUnitsWithDiagnostics(
          segments,
          textUnits,
          { minSegmentLength: 5 },
        );

        console.info('[AudiobookSyncDebug] Transcript diagnostics', diagnostics);
        return diagnostics;
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
  }, [
    bookKey,
    isLoaded,
    getConfig,
    setConfig,
    getView,
    getProgress,
    applyAudiobookMarker,
    appService,
  ]);
};
