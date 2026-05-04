import { useCallback } from 'react';
import {
  AudiobookConfig,
  AudiobookTextUnit,
  AudiobookTranscriptSegment,
  BookConfig,
} from '@/types/book';
import {
  matchTranscriptSegmentsToTextUnitsWithDiagnostics,
  parseAudiobookTranscript,
  computeAdjacentTranscriptCandidates,
} from '@/utils/audiobookTranscript';
import { getFilename } from '@/utils/path';
import {
  extractTextUnitsFromWholeBook,
  extractTextUnitsFromVisibleSections,
  type BookViewLike,
  type VisibleViewLike,
} from '@/utils/transcriptSync';

export interface SyncGenerationResult {
  matched: number;
  total: number;
  transcriptPath?: string;
  error?: string;
}

/** Structural view shape needed by the text-extraction pipeline. */
interface SyncView {
  book: { sections: unknown[] };
  getCFI(index: number, range: Range): string;
  renderer?: { getContents?: () => { doc: Document; index?: number }[] };
}

export interface SyncGenerationDeps {
  getView: (key: string) => unknown;
  appService: unknown;
  getConfig: (key: string) => BookConfig | null;
  setConfig: (key: string, partial: Partial<BookConfig>) => void;
}

/** Shared logic for the transcript → syncMap pipeline. */
export function useAudiobookSyncGeneration(deps: SyncGenerationDeps) {
  const { getView, appService, getConfig, setConfig } = deps;
  // Narrow appService for internal use — the real AppService type varies across platforms.
  type AppFS = {
    readFile(path: string, baseDir: string, mode: string): Promise<string | number[]>;
  };
  const fs = appService as AppFS | null;

  const parseMatchPersist = useCallback(
    async (
      bookKey: string,
      audiobook: AudiobookConfig,
      transcriptText: string,
      transcriptPath: string | undefined,
      logPrefix: string,
    ): Promise<SyncGenerationResult> => {
      // --- Parse transcript ---
      const segments: AudiobookTranscriptSegment[] = parseAudiobookTranscript(transcriptText);
      if (segments.length === 0) {
        const error = 'No valid transcript segments in generated transcript';
        setConfig(bookKey, {
          audiobook: { ...audiobook, transcriptStatus: 'error', transcriptError: error },
          updatedAt: Date.now(),
        });
        return { matched: 0, total: 0, error };
      }

      // --- Extract text units ---
      const view = getView(bookKey) as SyncView | null;
      if (!view) {
        const error = 'No view available for text extraction';
        setConfig(bookKey, {
          audiobook: { ...audiobook, transcriptStatus: 'error', transcriptError: error },
          updatedAt: Date.now(),
        });
        return { matched: 0, total: segments.length, error };
      }

      let textUnits: AudiobookTextUnit[];
      try {
        const result = await extractTextUnitsFromWholeBook(view as BookViewLike);
        textUnits = result.units;
      } catch {
        textUnits = [];
      }
      if (textUnits.length === 0) {
        textUnits = extractTextUnitsFromVisibleSections(view as VisibleViewLike);
      }
      if (textUnits.length === 0) {
        const error = 'No text units extracted from EPUB';
        setConfig(bookKey, {
          audiobook: { ...audiobook, transcriptStatus: 'error', transcriptError: error },
          updatedAt: Date.now(),
        });
        return { matched: 0, total: segments.length, error };
      }

      // --- Match ---
      const { entries: syncMap, diagnostics } = matchTranscriptSegmentsToTextUnitsWithDiagnostics(
        segments,
        textUnits,
        { minSegmentLength: 5 },
      );

      console.info(`[${logPrefix}] diagnostics`, diagnostics);

      if (syncMap.length === 0) {
        const error = 'No transcript segments matched EPUB text';
        setConfig(bookKey, {
          audiobook: {
            ...audiobook,
            transcriptPath,
            transcriptFileName: transcriptPath ? getFilename(transcriptPath) : undefined,
            transcriptStatus: 'error',
            transcriptError: error,
          },
          updatedAt: Date.now(),
        });
        return { matched: 0, total: segments.length, error };
      }

      // --- Persist ---
      const updatedAudiobook: AudiobookConfig = {
        ...audiobook,
        transcriptPath,
        transcriptFileName: transcriptPath ? getFilename(transcriptPath) : undefined,
        transcriptStatus: 'ready',
        transcriptError: undefined,
        transcriptGeneratedAt: Date.now(),
        syncMap,
        syncStatus: 'ready',
      };
      setConfig(bookKey, { audiobook: updatedAudiobook, updatedAt: Date.now() });

      return { matched: syncMap.length, total: segments.length, transcriptPath };
    },
    [getView, setConfig],
  );

  /** Build syncMap from an already-attached transcript file. */
  const generateSyncMapFromAttachedTranscript = useCallback(
    async (bookKey: string): Promise<SyncGenerationResult> => {
      const config = getConfig(bookKey);
      const audiobook = config?.audiobook;
      if (!audiobook) return { matched: 0, total: 0, error: 'No audiobook attached' };
      if (!audiobook.transcriptPath) {
        return { matched: 0, total: 0, error: 'No transcript file attached' };
      }

      let transcriptText: string;
      try {
        const content = await fs?.readFile(audiobook.transcriptPath, 'None' as string, 'text');
        if (typeof content !== 'string') {
          return { matched: 0, total: 0, error: 'Transcript file returned binary data' };
        }
        transcriptText = content;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return { matched: 0, total: 0, error: `Failed to read transcript file: ${raw}` };
      }

      return parseMatchPersist(
        bookKey,
        audiobook,
        transcriptText,
        audiobook.transcriptPath,
        'AudiobookSyncGeneration',
      );
    },
    [getConfig, appService, parseMatchPersist],
  );

  /**
   * Dev-only: locate or generate a transcript from the attached audiobook file,
   * then produce a syncMap.
   * - Option A: reads an adjacent .srt/.vtt/.json/.txt file
   * - Option B: invokes Python/faster-whisper via Tauri shell (requires dev deps)
   */
  const generateTranscriptFromAudiobook = useCallback(
    async (
      bookKey: string,
      options?: { model?: string; language?: string },
    ): Promise<SyncGenerationResult> => {
      const config = getConfig(bookKey);
      const audiobook = config?.audiobook;
      if (!audiobook) return { matched: 0, total: 0, error: 'No audiobook attached' };
      if (!audiobook.filePath) return { matched: 0, total: 0, error: 'No audio file path' };

      const model = options?.model ?? 'base';

      // Mark as pending
      setConfig(bookKey, {
        audiobook: { ...audiobook, transcriptStatus: 'pending', transcriptError: undefined },
        updatedAt: Date.now(),
      });

      // --- Option A: adjacent transcript ---
      let transcriptText: string | null = null;
      let transcriptPath: string | undefined;

      const candidates = computeAdjacentTranscriptCandidates(audiobook.filePath);
      for (const candidate of candidates) {
        try {
          const content = await fs?.readFile(candidate, 'None' as string, 'text');
          if (typeof content === 'string' && content.trim().length > 0) {
            transcriptText = content;
            transcriptPath = candidate;
            console.info('[AudiobookSyncGeneration] Found adjacent transcript', { candidate });
            break;
          }
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          if (
            raw.includes('not allowed') ||
            raw.toLowerCase().includes('permission') ||
            raw.toLowerCase().includes('scope')
          ) {
            console.warn(
              '[AudiobookSyncGeneration] Adjacent transcript read blocked by Tauri permission, continuing to Python fallback',
              candidate,
            );
          }
        }
      }

      // --- Option B: Python transcription ---
      if (!transcriptText) {
        // Use app cache for transcript output — Tauri fs can read from $APPCACHE
        let transcriptOutputDir: string;
        try {
          const { appCacheDir, join } = await import('@tauri-apps/api/path');
          const cacheDir = await appCacheDir();
          const audioFilename = getFilename(audiobook.filePath);
          const safeDir = audioFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
          transcriptOutputDir = await join(cacheDir, 'Citadel', 'audiobook-transcripts', safeDir);
        } catch {
          console.error('[AudiobookSyncGeneration] Failed to resolve app cache dir');
          transcriptOutputDir = '';
        }

        // Build candidate script paths
        let scriptCandidates: string[] = [];
        try {
          const { resourceDir, join } = await import('@tauri-apps/api/path');
          const rd = await resourceDir();
          const raw = [
            await join(rd, '..', '..', 'apps', 'readest-app', 'scripts', 'transcribe_audiobook.py'),
            await join(rd, '..', 'scripts', 'transcribe_audiobook.py'),
            await join(rd, 'apps', 'readest-app', 'scripts', 'transcribe_audiobook.py'),
          ];
          scriptCandidates = [...new Set(raw)];
        } catch {
          console.error('[AudiobookSyncGeneration] Failed to build script candidates');
        }

        const pythonRuntimes = [
          { name: 'py-transcribe', label: 'py -3.10', prefixArgs: ['-3.10'] },
          { name: 'python-transcribe', label: 'python', prefixArgs: [] },
          { name: 'py-transcribe', label: 'py', prefixArgs: [] },
        ] as const;

        let selectedRuntime: (typeof pythonRuntimes)[number] | undefined;
        let selectedScriptPath: string | undefined;

        for (const rt of pythonRuntimes) {
          try {
            const { Command } = await import('@tauri-apps/plugin-shell');

            // Probe faster_whisper
            const fwProbe = Command.create(rt.name, [
              ...rt.prefixArgs,
              '-c',
              'import sys; print(sys.executable); import faster_whisper; print("OK")',
            ]);
            const fwOutput = await fwProbe.execute();
            if (fwOutput.code === 127 || fwOutput.code === 9009) {
              console.warn(`[AudiobookSyncGeneration] ${rt.label} not found on PATH`);
              continue;
            }
            if (fwOutput.code !== 0) {
              console.warn(
                `[AudiobookSyncGeneration] ${rt.label} found but faster_whisper not available`,
                fwOutput.stderr?.trim(),
              );
              continue;
            }
            const fwLines = (fwOutput.stdout?.trim() ?? '').split('\n');
            console.info(
              `[AudiobookSyncGeneration] Using ${rt.label} — ${fwLines[0]?.trim() ?? 'unknown path'}`,
            );

            // Find script
            for (const candidate of scriptCandidates) {
              const scriptProbe = Command.create(rt.name, [...rt.prefixArgs, candidate, '--help']);
              const scriptProbeOutput = await scriptProbe.execute();
              if (scriptProbeOutput.code === 0) {
                selectedScriptPath = candidate;
                break;
              }
            }

            if (!selectedScriptPath) {
              console.error('[AudiobookSyncGeneration] Script not found. Tried:', scriptCandidates);
              break;
            }

            selectedRuntime = rt;
            break;
          } catch (err) {
            const raw = err instanceof Error ? err.message : String(err);
            if (
              raw.includes('not allowed') ||
              raw.toLowerCase().includes('permission') ||
              raw.toLowerCase().includes('scope')
            ) {
              console.error(
                `[AudiobookSyncGeneration] ${rt.label} blocked by Tauri permission`,
                raw,
              );
            } else {
              console.warn(`[AudiobookSyncGeneration] ${rt.label} command failed`, err);
            }
          }
        }

        if (selectedRuntime && selectedScriptPath && transcriptOutputDir) {
          try {
            const { Command } = await import('@tauri-apps/plugin-shell');
            const command = Command.create(selectedRuntime.name, [
              ...selectedRuntime.prefixArgs,
              selectedScriptPath,
              '--audio',
              audiobook.filePath,
              '--output-dir',
              transcriptOutputDir,
              '--model',
              model,
              '--format',
              'srt',
            ]);
            const output = await command.execute();

            if (output.code !== 0) {
              const stderr = output.stderr?.trim();
              if (stderr?.includes('Missing faster-whisper')) {
                console.error('[AudiobookSyncGeneration] faster-whisper not installed.', stderr);
              } else {
                console.error(
                  `[AudiobookSyncGeneration] Transcription script failed (exit ${output.code}):`,
                  stderr || '(no stderr)',
                );
              }
            } else {
              const stdout = output.stdout?.trim();
              if (stdout) {
                const stdoutLines = stdout.split('\n');
                const outputPath = stdoutLines[stdoutLines.length - 1]!.trim();
                const srtContent = await fs?.readFile(outputPath, 'None' as string, 'text');
                if (typeof srtContent === 'string' && srtContent.trim().length > 0) {
                  transcriptText = srtContent;
                  transcriptPath = outputPath;
                  console.info(
                    `[AudiobookSyncGeneration] Generated transcript via ${selectedRuntime.label}`,
                    outputPath,
                  );
                }
              }
            }
          } catch (err) {
            console.warn(`[AudiobookSyncGeneration] ${selectedRuntime.label} command failed`, err);
          }
        }
      }

      if (!transcriptText) {
        const error =
          'No transcript found — attach a transcript file or ensure Python with faster-whisper is available';
        setConfig(bookKey, {
          audiobook: { ...audiobook, transcriptStatus: 'error', transcriptError: error },
          updatedAt: Date.now(),
        });
        return { matched: 0, total: 0, error };
      }

      return parseMatchPersist(
        bookKey,
        audiobook,
        transcriptText,
        transcriptPath,
        'AudiobookSyncGeneration',
      );
    },
    [getConfig, setConfig, appService, parseMatchPersist],
  );

  return { generateSyncMapFromAttachedTranscript, generateTranscriptFromAudiobook };
}
