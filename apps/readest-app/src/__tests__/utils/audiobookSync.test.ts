import { describe, it, expect } from 'vitest';
import { findAudiobookSyncEntry } from '@/utils/audiobookSync';
import { AudiobookSyncMapEntry } from '@/types/book';

describe('utils/audiobookSync', () => {
  describe('findAudiobookSyncEntry', () => {
    it('returns null for undefined syncMap', () => {
      const result = findAudiobookSyncEntry(undefined, 10);
      expect(result).toBeNull();
    });

    it('returns null for empty syncMap', () => {
      const result = findAudiobookSyncEntry([], 10);
      expect(result).toBeNull();
    });

    it('returns null when all entries are in the future', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 15, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 20, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 10);
      expect(result).toBeNull();
    });

    it('returns the only entry when it matches', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:0)', label: 'Chapter 1' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 10);
      expect(result).toEqual(syncMap[0]);
    });

    it('returns the latest entry when multiple entries are before currentTime', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
        { time: 10, cfi: 'epubcfi(/6/4!/4/2/1:20)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 12);
      expect(result).toEqual(syncMap[2]);
    });

    it('returns exact match when currentTime equals entry time', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 10, cfi: 'epubcfi(/6/4!/4/2/1:10)', label: 'Exact' },
        { time: 20, cfi: 'epubcfi(/6/4!/4/2/1:20)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 10);
      expect(result).toEqual(syncMap[1]);
    });

    it('ignores future entries and returns the latest past entry', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
        { time: 15, cfi: 'epubcfi(/6/4!/4/2/1:20)' },
        { time: 20, cfi: 'epubcfi(/6/4!/4/2/1:30)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 10);
      expect(result).toEqual(syncMap[1]);
    });

    it('handles unsorted syncMap correctly', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 10, cfi: 'epubcfi(/6/4!/4/2/1:20)' },
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 12);
      expect(result).toEqual(syncMap[0]);
    });

    it('handles entries with labels', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)', label: 'Start' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)', label: 'Chapter 1' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 7);
      expect(result).toEqual(syncMap[1]);
      expect(result?.label).toBe('Chapter 1');
    });

    it('returns first entry at time 0 when currentTime is 0', () => {
      const syncMap: AudiobookSyncMapEntry[] = [
        { time: 0, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
        { time: 5, cfi: 'epubcfi(/6/4!/4/2/1:10)' },
      ];
      const result = findAudiobookSyncEntry(syncMap, 0);
      expect(result).toEqual(syncMap[0]);
    });
  });
});
