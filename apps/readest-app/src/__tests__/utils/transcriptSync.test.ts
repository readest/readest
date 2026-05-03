import { describe, it, expect } from 'vitest';
import {
  normalizeForSpotMatch,
  parseSRT,
  parseVTT,
  parseTranscriptJSON,
  parseTranscript,
  normalizeTranscriptSegments,
  buildSyncMapFromTranscript,
  selectBestSpotMatch,
} from '@/utils/transcriptSync';
import { AudiobookTranscriptSegment, BookSearchMatch } from '@/types/book';

describe('utils/transcriptSync', () => {
  // ── normalizeForSpotMatch ──────────────────────────────────────────

  describe('normalizeForSpotMatch', () => {
    it('lowercases text', () => {
      expect(normalizeForSpotMatch('Hello World')).toBe('hello world');
    });

    it('strips punctuation', () => {
      expect(normalizeForSpotMatch('Hello, world!')).toBe('hello world');
    });

    it('collapses whitespace', () => {
      expect(normalizeForSpotMatch('Hello   world')).toBe('hello world');
    });

    it('trims leading/trailing whitespace', () => {
      expect(normalizeForSpotMatch('  hello  ')).toBe('hello');
    });

    it('handles unicode punctuation', () => {
      expect(normalizeForSpotMatch('«Bonjour» — dit-il')).toBe('bonjour ditil');
    });
  });

  // ── parseSRT ───────────────────────────────────────────────────────

  describe('parseSRT', () => {
    it('parses a basic SRT file', () => {
      const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,500
Second line`;
      const result = parseSRT(srt);
      expect(result).toHaveLength(2);
      expect(result[0]!.start).toBeCloseTo(1.0);
      expect(result[0]!.end).toBeCloseTo(4.0);
      expect(result[0]!.text).toBe('Hello world');
      expect(result[1]!.start).toBeCloseTo(5.0);
      expect(result[1]!.end).toBeCloseTo(8.5);
      expect(result[1]!.text).toBe('Second line');
    });

    it('handles multi-line text', () => {
      const srt = `1
00:00:01,000 --> 00:00:04,000
Line one
Line two`;
      const result = parseSRT(srt);
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('Line one Line two');
    });

    it('returns empty for invalid SRT', () => {
      expect(parseSRT('not valid srt')).toHaveLength(0);
    });

    it('handles hours correctly', () => {
      const srt = `1
01:30:00,000 --> 01:30:05,000
An hour and a half in`;
      const result = parseSRT(srt);
      expect(result[0]!.start).toBeCloseTo(5400);
    });
  });

  // ── parseVTT ───────────────────────────────────────────────────────

  describe('parseVTT', () => {
    it('parses a basic VTT file', () => {
      const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:08.500
Second line`;
      const result = parseVTT(vtt);
      expect(result).toHaveLength(2);
      expect(result[0]!.start).toBeCloseTo(1.0);
      expect(result[0]!.end).toBeCloseTo(4.0);
      expect(result[0]!.text).toBe('Hello world');
    });

    it('returns empty for VTT without timestamps', () => {
      const vtt = 'WEBVTT\n\nNo timestamps here';
      expect(parseVTT(vtt)).toHaveLength(0);
    });
  });

  // ── parseTranscriptJSON ────────────────────────────────────────────

  describe('parseTranscriptJSON', () => {
    it('parses an array of segments', () => {
      const json = JSON.stringify([
        { start: 0, end: 5, text: 'Hello' },
        { start: 5, end: 10, text: 'World' },
      ]);
      const result = parseTranscriptJSON(json);
      expect(result).toHaveLength(2);
      expect(result[0]!.start).toBe(0);
      expect(result[0]!.text).toBe('Hello');
    });

    it('parses an object with segments array', () => {
      const json = JSON.stringify({
        segments: [
          { start: 1, text: 'First' },
          { start: 2, text: 'Second' },
        ],
      });
      const result = parseTranscriptJSON(json);
      expect(result).toHaveLength(2);
    });

    it('filters out invalid segments', () => {
      const json = JSON.stringify([
        { start: -1, text: 'Negative' },
        { start: 5, text: '' },
        { start: 10, text: 'Valid' },
        { start: NaN, text: 'NaN' },
      ]);
      const result = parseTranscriptJSON(json);
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('Valid');
    });

    it('returns empty for invalid JSON', () => {
      expect(parseTranscriptJSON('not json')).toHaveLength(0);
    });

    it('returns empty for non-array/object JSON', () => {
      expect(parseTranscriptJSON('"hello"')).toHaveLength(0);
    });
  });

  // ── parseTranscript (auto-detect) ──────────────────────────────────

  describe('parseTranscript', () => {
    it('detects JSON format', () => {
      const json = JSON.stringify([{ start: 0, text: 'Hello' }]);
      const result = parseTranscript(json);
      expect(result).toHaveLength(1);
    });

    it('detects VTT format', () => {
      const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello';
      const result = parseTranscript(vtt);
      expect(result).toHaveLength(1);
    });

    it('detects SRT format', () => {
      const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello';
      const result = parseTranscript(srt);
      expect(result).toHaveLength(1);
    });
  });

  // ── normalizeTranscriptSegments ────────────────────────────────────

  describe('normalizeTranscriptSegments', () => {
    it('returns empty for undefined input', () => {
      expect(normalizeTranscriptSegments(undefined)).toEqual([]);
    });

    it('filters out invalid segments', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: NaN, text: 'bad' },
        { start: -1, text: 'negative' },
        { start: 5, text: '' },
        { start: 10, text: 'valid' },
      ];
      const result = normalizeTranscriptSegments(segments);
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('valid');
    });

    it('sorts by start time', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 20, text: 'third' },
        { start: 5, text: 'first' },
        { start: 10, text: 'second' },
      ];
      const result = normalizeTranscriptSegments(segments);
      expect(result.map((s) => s.start)).toEqual([5, 10, 20]);
    });

    it('removes exact duplicate start+text pairs', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 5, text: 'hello' },
        { start: 5, text: 'hello' },
        { start: 5, text: 'world' },
      ];
      const result = normalizeTranscriptSegments(segments);
      expect(result).toHaveLength(2);
    });
  });

  // ── buildSyncMapFromTranscript ──────────────────────────────────────

  describe('buildSyncMapFromTranscript', () => {
    it('returns empty for undefined segments', () => {
      expect(buildSyncMapFromTranscript(undefined)).toEqual([]);
    });

    it('returns empty for empty segments', () => {
      expect(buildSyncMapFromTranscript([])).toEqual([]);
    });

    it('builds entries with secondsStart and secondsEnd from next segment', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, end: 5, text: 'First segment' },
        { start: 5, end: 10, text: 'Second segment' },
        { start: 10, end: 15, text: 'Third segment' },
      ];
      const map = buildSyncMapFromTranscript(segments);
      expect(map).toHaveLength(3);
      expect(map[0]!.secondsStart).toBe(0);
      expect(map[0]!.secondsEnd).toBe(5);
      expect(map[1]!.secondsStart).toBe(5);
      expect(map[1]!.secondsEnd).toBe(10);
      expect(map[2]!.secondsStart).toBe(10);
      expect(map[2]!.secondsEnd).toBe(15);
    });

    it('uses duration for final entry when no end', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, text: 'First segment here' },
        { start: 5, text: 'Last segment here' },
      ];
      const map = buildSyncMapFromTranscript(segments, { duration: 30 });
      expect(map).toHaveLength(2);
      expect(map[1]!.secondsEnd).toBe(30);
    });

    it('uses segment end for final entry when available', () => {
      const segments: AudiobookTranscriptSegment[] = [{ start: 5, end: 12, text: 'Only segment' }];
      const map = buildSyncMapFromTranscript(segments);
      expect(map[0]!.secondsEnd).toBe(12);
    });

    it('sets source to generated', () => {
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: 'Hello world' }];
      const map = buildSyncMapFromTranscript(segments);
      expect(map[0]!.source).toBe('generated');
    });

    it('sets label to first 60 chars of text', () => {
      const longText = 'A'.repeat(100);
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: longText }];
      const map = buildSyncMapFromTranscript(segments);
      expect(map[0]!.label).toBe('A'.repeat(60));
    });

    it('sets cfi to empty placeholder', () => {
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: 'Hello' }];
      const map = buildSyncMapFromTranscript(segments);
      expect(map[0]!.cfi).toBe('');
    });

    it('skips segments shorter than minSegmentLength', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, text: 'Hi' },
        { start: 5, text: 'Hello world this is longer' },
      ];
      const map = buildSyncMapFromTranscript(segments, { minSegmentLength: 10 });
      expect(map).toHaveLength(1);
      expect(map[0]!.label).toBe('Hello world this is longer');
    });
  });

  // ── selectBestSpotMatch ────────────────────────────────────────────

  describe('selectBestSpotMatch', () => {
    it('returns null for empty matches', () => {
      expect(selectBestSpotMatch('hello', [])).toBeNull();
    });

    it('returns the best matching result', () => {
      const matches: BookSearchMatch[] = [
        { cfi: 'cfi-1', excerpt: { pre: '', match: 'unrelated text', post: '' } },
        { cfi: 'cfi-2', excerpt: { pre: '', match: 'the quick brown fox', post: '' } },
      ];
      const result = selectBestSpotMatch('the quick brown fox jumps', matches);
      expect(result).not.toBeNull();
      expect(result!.cfi).toBe('cfi-2');
    });

    it('returns null when no match meets 30% threshold', () => {
      const matches: BookSearchMatch[] = [
        { cfi: 'cfi-1', excerpt: { pre: '', match: 'completely different', post: '' } },
      ];
      const result = selectBestSpotMatch('the quick brown fox', matches);
      expect(result).toBeNull();
    });

    it('handles string excerpt format', () => {
      const matches: BookSearchMatch[] = [
        { cfi: 'cfi-1', excerpt: { pre: '', match: 'the quick brown fox jumps over', post: '' } },
      ];
      const result = selectBestSpotMatch('the quick brown fox', matches);
      expect(result).not.toBeNull();
      expect(result!.cfi).toBe('cfi-1');
    });
  });
});
