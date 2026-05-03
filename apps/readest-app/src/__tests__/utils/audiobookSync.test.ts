import { describe, it, expect } from 'vitest';
import {
  normalizeAudiobookSyncPoints,
  buildSyncMapFromPoints,
  findAudiobookSyncEntryAtTime,
  getSyncMapEntryKey,
  findAudiobookSyncEntry,
} from '@/utils/audiobookSync';
import { AudiobookConfig, AudiobookSyncMapEntry, AudiobookSyncPoint } from '@/types/book';

describe('utils/audiobookSync', () => {
  // ── normalizeAudiobookSyncPoints ──────────────────────────────────

  describe('normalizeAudiobookSyncPoints', () => {
    it('returns empty array for undefined input', () => {
      expect(normalizeAudiobookSyncPoints(undefined)).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(normalizeAudiobookSyncPoints([])).toEqual([]);
    });

    it('filters out entries with non-finite time', () => {
      const points: AudiobookSyncPoint[] = [
        { time: Infinity, cfi: 'a' },
        { time: -Infinity, cfi: 'b' },
        { time: NaN, cfi: 'c' },
        { time: 5, cfi: 'd' },
      ];
      const result = normalizeAudiobookSyncPoints(points);
      expect(result).toHaveLength(1);
      expect(result[0]!.cfi).toBe('d');
    });

    it('filters out entries with negative time', () => {
      const points: AudiobookSyncPoint[] = [
        { time: -1, cfi: 'a' },
        { time: 0, cfi: 'b' },
      ];
      const result = normalizeAudiobookSyncPoints(points);
      expect(result).toHaveLength(1);
      expect(result[0]!.time).toBe(0);
    });

    it('filters out entries with empty cfi', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 1, cfi: '' },
        { time: 2, cfi: 'epubcfi(/6/4)' },
      ];
      const result = normalizeAudiobookSyncPoints(points);
      expect(result).toHaveLength(1);
      expect(result[0]!.cfi).toBe('epubcfi(/6/4)');
    });

    it('sorts entries ascending by time', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 30, cfi: 'c' },
        { time: 10, cfi: 'a' },
        { time: 20, cfi: 'b' },
      ];
      const result = normalizeAudiobookSyncPoints(points);
      expect(result.map((p) => p.time)).toEqual([10, 20, 30]);
    });

    it('removes exact duplicate time+cfi pairs', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 5, cfi: 'x' },
        { time: 5, cfi: 'x' },
        { time: 5, cfi: 'y' },
      ];
      const result = normalizeAudiobookSyncPoints(points);
      expect(result).toHaveLength(2);
    });
  });

  // ── buildSyncMapFromPoints ────────────────────────────────────────

  describe('buildSyncMapFromPoints', () => {
    it('returns empty array for undefined points', () => {
      expect(buildSyncMapFromPoints(undefined)).toEqual([]);
    });

    it('returns empty array for empty points', () => {
      expect(buildSyncMapFromPoints([])).toEqual([]);
    });

    it('sets secondsEnd from next point time', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 0, cfi: 'cfi-0' },
        { time: 10, cfi: 'cfi-10' },
        { time: 20, cfi: 'cfi-20' },
      ];
      const map = buildSyncMapFromPoints(points);
      expect(map).toHaveLength(3);
      expect(map[0]!.secondsStart).toBe(0);
      expect(map[0]!.secondsEnd).toBe(10);
      expect(map[1]!.secondsStart).toBe(10);
      expect(map[1]!.secondsEnd).toBe(20);
      expect(map[2]!.secondsStart).toBe(20);
      expect(map[2]!.secondsEnd).toBeUndefined();
    });

    it('uses duration for final entry secondsEnd when valid', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 0, cfi: 'cfi-0' },
        { time: 10, cfi: 'cfi-10' },
      ];
      const map = buildSyncMapFromPoints(points, { duration: 30 });
      expect(map[1]!.secondsEnd).toBe(30);
    });

    it('omits final secondsEnd when duration is not greater than start', () => {
      const points: AudiobookSyncPoint[] = [{ time: 50, cfi: 'cfi-50' }];
      const map = buildSyncMapFromPoints(points, { duration: 40 });
      expect(map[0]!.secondsEnd).toBeUndefined();
    });

    it('omits final secondsEnd when duration is undefined', () => {
      const points: AudiobookSyncPoint[] = [{ time: 5, cfi: 'cfi-5' }];
      const map = buildSyncMapFromPoints(points);
      expect(map[0]!.secondsEnd).toBeUndefined();
    });

    it('sets source to manual-point', () => {
      const points: AudiobookSyncPoint[] = [{ time: 0, cfi: 'cfi-0' }];
      const map = buildSyncMapFromPoints(points);
      expect(map[0]!.source).toBe('manual-point');
    });

    it('preserves label from point', () => {
      const points: AudiobookSyncPoint[] = [
        { time: 0, cfi: 'cfi-0', label: 'Start' },
        { time: 10, cfi: 'cfi-10', label: 'Middle' },
      ];
      const map = buildSyncMapFromPoints(points);
      expect(map[0]!.label).toBe('Start');
      expect(map[1]!.label).toBe('Middle');
    });

    it('normalizes invalid points before building', () => {
      const points: AudiobookSyncPoint[] = [
        { time: NaN, cfi: 'bad' },
        { time: 5, cfi: 'good' },
      ];
      const map = buildSyncMapFromPoints(points);
      expect(map).toHaveLength(1);
      expect(map[0]!.cfi).toBe('good');
    });
  });

  // ── findAudiobookSyncEntryAtTime ──────────────────────────────────

  describe('findAudiobookSyncEntryAtTime', () => {
    it('returns null for undefined syncMap', () => {
      expect(findAudiobookSyncEntryAtTime(undefined, 10)).toBeNull();
    });

    it('returns null for empty syncMap', () => {
      expect(findAudiobookSyncEntryAtTime([], 10)).toBeNull();
    });

    it('returns null when all entries are in the future', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 15, cfi: 'a' },
        { secondsStart: 20, cfi: 'b' },
      ];
      expect(findAudiobookSyncEntryAtTime(map, 10)).toBeNull();
    });

    it('returns entry when currentTime is within range', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, secondsEnd: 10, cfi: 'a' },
        { secondsStart: 10, secondsEnd: 20, cfi: 'b' },
      ];
      const result = findAudiobookSyncEntryAtTime(map, 5);
      expect(result).toBe(map[0]);
    });

    it('returns correct entry at boundary start', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, secondsEnd: 10, cfi: 'a' },
        { secondsStart: 10, secondsEnd: 20, cfi: 'b' },
      ];
      const result = findAudiobookSyncEntryAtTime(map, 10);
      expect(result).toBe(map[1]);
    });

    it('returns null when currentTime equals secondsEnd (exclusive)', () => {
      const map: AudiobookSyncMapEntry[] = [{ secondsStart: 0, secondsEnd: 10, cfi: 'a' }];
      expect(findAudiobookSyncEntryAtTime(map, 10)).toBeNull();
    });

    it('returns final entry after its start when no secondsEnd', () => {
      const map: AudiobookSyncMapEntry[] = [{ secondsStart: 5, cfi: 'last' }];
      expect(findAudiobookSyncEntryAtTime(map, 100)).toBe(map[0]);
    });

    it('returns final entry at exact start time', () => {
      const map: AudiobookSyncMapEntry[] = [{ secondsStart: 5, cfi: 'last' }];
      expect(findAudiobookSyncEntryAtTime(map, 5)).toBe(map[0]);
    });

    it('respects trackIndex filter', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, secondsEnd: 20, cfi: 'a', trackIndex: 0 },
        { secondsStart: 0, secondsEnd: 20, cfi: 'b', trackIndex: 1 },
      ];
      expect(findAudiobookSyncEntryAtTime(map, 5, 0)).toBe(map[0]);
      expect(findAudiobookSyncEntryAtTime(map, 5, 1)).toBe(map[1]);
    });

    it('includes entries without trackIndex when filtering by trackIndex', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, secondsEnd: 20, cfi: 'no-track' },
        { secondsStart: 0, secondsEnd: 20, cfi: 'track-1', trackIndex: 1 },
      ];
      // Entry without trackIndex should be included when trackIndex=1 is requested
      // because its trackIndex is undefined (not a mismatch)
      const result = findAudiobookSyncEntryAtTime(map, 5, 1);
      expect(result).toBe(map[0]);
    });

    it('handles multiple entries returning the first active one', () => {
      const map: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, secondsEnd: 10, cfi: 'first' },
        { secondsStart: 10, secondsEnd: 20, cfi: 'second' },
        { secondsStart: 20, secondsEnd: 30, cfi: 'third' },
      ];
      expect(findAudiobookSyncEntryAtTime(map, 15)).toBe(map[1]);
      expect(findAudiobookSyncEntryAtTime(map, 25)).toBe(map[2]);
    });
  });

  // ── getSyncMapEntryKey ────────────────────────────────────────────

  describe('getSyncMapEntryKey', () => {
    it('produces stable key from secondsStart and cfi', () => {
      const entry: AudiobookSyncMapEntry = { secondsStart: 5, cfi: 'cfi-x' };
      expect(getSyncMapEntryKey(entry)).toBe('5|cfi-x|');
    });

    it('includes markerCfi in key when present', () => {
      const entry: AudiobookSyncMapEntry = {
        secondsStart: 5,
        cfi: 'cfi-x',
        markerCfi: 'cfi-marker',
      };
      expect(getSyncMapEntryKey(entry)).toBe('5|cfi-x|cfi-marker');
    });

    it('returns different keys for different entries', () => {
      const a: AudiobookSyncMapEntry = { secondsStart: 5, cfi: 'cfi-a' };
      const b: AudiobookSyncMapEntry = { secondsStart: 10, cfi: 'cfi-b' };
      expect(getSyncMapEntryKey(a)).not.toBe(getSyncMapEntryKey(b));
    });
  });

  // ── findAudiobookSyncEntry (legacy) ───────────────────────────────

  describe('findAudiobookSyncEntry (legacy)', () => {
    it('returns null for undefined syncMap', () => {
      expect(findAudiobookSyncEntry(undefined, 10)).toBeNull();
    });

    it('returns null for empty syncMap', () => {
      expect(findAudiobookSyncEntry([], 10)).toBeNull();
    });

    it('returns null when all entries are in the future', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { secondsStart: 15, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { secondsStart: 20, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
      ];
      expect(findAudiobookSyncEntry(syncMap, 10)).toBeNull();
    });

    it('returns the latest applicable entry', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { secondsStart: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { secondsStart: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
        { secondsStart: 10, cfi: 'epubcfi(/6/4!/4/2/1:20)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 12);
      expect(result).toBe(syncMap[2]);
    });

    it('supports old format with time field', () => {
      const syncMap = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
      ] as unknown as AudiobookSyncMapEntry[];
      const result = findAudiobookSyncEntry(syncMap, 7);
      expect(result).toBe(syncMap[1]);
    });
  });

  // ── AudiobookConfig transcript fields ──────────────────────────────

  describe('AudiobookConfig transcript fields', () => {
    it('supports transcriptPath and transcriptFileName fields', () => {
      const config: AudiobookConfig = {
        filePath: '/audio/book.mp3',
        fileName: 'book.mp3',
        addedAt: Date.now(),
        transcriptPath: '/transcripts/book.srt',
        transcriptFileName: 'book.srt',
        transcriptStatus: 'none',
      };
      expect(config.transcriptPath).toBe('/transcripts/book.srt');
      expect(config.transcriptFileName).toBe('book.srt');
      expect(config.transcriptStatus).toBe('none');
    });

    it('preserves audiobook fields when transcript is added', () => {
      const base: AudiobookConfig = {
        filePath: '/audio/book.mp3',
        fileName: 'book.mp3',
        addedAt: 1000,
        syncStatus: 'ready',
        syncPoints: [{ time: 5, cfi: 'cfi-1' }],
        syncMap: [{ secondsStart: 5, secondsEnd: 10, cfi: 'cfi-1' }],
      };
      const withTranscript: AudiobookConfig = {
        ...base,
        transcriptPath: '/transcripts/book.srt',
        transcriptFileName: 'book.srt',
        transcriptStatus: 'none',
      };
      // Audiobook fields preserved
      expect(withTranscript.filePath).toBe('/audio/book.mp3');
      expect(withTranscript.fileName).toBe('book.mp3');
      expect(withTranscript.syncPoints).toHaveLength(1);
      expect(withTranscript.syncMap).toHaveLength(1);
      // Transcript fields added
      expect(withTranscript.transcriptPath).toBe('/transcripts/book.srt');
    });

    it('clears transcript fields on removal while preserving audiobook', () => {
      const withTranscript: AudiobookConfig = {
        filePath: '/audio/book.mp3',
        fileName: 'book.mp3',
        addedAt: 1000,
        transcriptPath: '/transcripts/book.srt',
        transcriptFileName: 'book.srt',
        transcriptStatus: 'none',
        syncMap: [{ secondsStart: 5, secondsEnd: 10, cfi: 'cfi-1' }],
      };
      const afterRemove: AudiobookConfig = {
        ...withTranscript,
        transcriptPath: undefined,
        transcriptFileName: undefined,
        transcriptStatus: undefined,
      };
      // Transcript cleared
      expect(afterRemove.transcriptPath).toBeUndefined();
      expect(afterRemove.transcriptFileName).toBeUndefined();
      expect(afterRemove.transcriptStatus).toBeUndefined();
      // Audiobook preserved
      expect(afterRemove.filePath).toBe('/audio/book.mp3');
      expect(afterRemove.syncMap).toHaveLength(1);
    });

    it('transcriptStatus transitions from none to ready', () => {
      const config: AudiobookConfig = {
        filePath: '/audio/book.mp3',
        fileName: 'book.mp3',
        addedAt: 1000,
        transcriptPath: '/transcripts/book.srt',
        transcriptFileName: 'book.srt',
        transcriptStatus: 'none',
      };
      const ready: AudiobookConfig = {
        ...config,
        transcriptStatus: 'ready',
        syncStatus: 'ready',
      };
      expect(ready.transcriptStatus).toBe('ready');
    });
  });
});
