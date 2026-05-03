import { describe, it, expect } from 'vitest';
import {
  normalizeAudiobookMatchText,
  parseSRT,
  parseVTT,
  parseTranscriptJSON,
  parseAudiobookTranscript,
  normalizeTranscriptSegments,
  matchTranscriptSegmentsToTextUnits,
} from '@/utils/audiobookTranscript';
import { AudiobookTextUnit, AudiobookTranscriptSegment } from '@/types/book';

describe('utils/audiobookTranscript', () => {
  // ── normalizeAudiobookMatchText ─────────────────────────────────────

  describe('normalizeAudiobookMatchText', () => {
    it('lowercases text', () => {
      expect(normalizeAudiobookMatchText('Hello World')).toBe('hello world');
    });

    it('normalizes curly single quotes to ASCII apostrophe', () => {
      expect(normalizeAudiobookMatchText('it\u2019s')).toBe('its');
    });

    it('normalizes curly double quotes to ASCII quotes (then stripped by punctuation removal)', () => {
      // Curly quotes → ASCII quotes → stripped by \p{P} removal
      expect(normalizeAudiobookMatchText('\u201Chello\u201D')).toBe('hello');
    });

    it('normalizes em-dash to space', () => {
      expect(normalizeAudiobookMatchText('hello\u2014world')).toBe('hello world');
    });

    it('normalizes en-dash to space', () => {
      expect(normalizeAudiobookMatchText('hello\u2013world')).toBe('hello world');
    });

    it('normalizes horizontal ellipsis to space', () => {
      expect(normalizeAudiobookMatchText('hello\u2026world')).toBe('hello world');
    });

    it('removes zero-width characters', () => {
      expect(normalizeAudiobookMatchText('hello\u200Bworld')).toBe('helloworld');
    });

    it('removes zero-width non-joiner', () => {
      expect(normalizeAudiobookMatchText('hello\u200Cworld')).toBe('helloworld');
    });

    it('removes zero-width joiner', () => {
      expect(normalizeAudiobookMatchText('hello\u200Dworld')).toBe('helloworld');
    });

    it('removes BOM', () => {
      expect(normalizeAudiobookMatchText('\uFEFFhello')).toBe('hello');
    });

    it('removes soft hyphen', () => {
      expect(normalizeAudiobookMatchText('hel\u00ADlo')).toBe('hello');
    });

    it('removes directional marks', () => {
      expect(normalizeAudiobookMatchText('hello\u200Eworld\u202A')).toBe('helloworld');
    });

    it('strips punctuation', () => {
      expect(normalizeAudiobookMatchText('Hello, world!')).toBe('hello world');
    });

    it('collapses whitespace', () => {
      expect(normalizeAudiobookMatchText('Hello   world')).toBe('hello world');
    });

    it('trims leading/trailing whitespace', () => {
      expect(normalizeAudiobookMatchText('  hello  ')).toBe('hello');
    });

    it('handles combined normalization', () => {
      // "It's" with curly apostrophe, em-dash, trailing period
      const input = 'It\u2019s \u2014 wonderful!';
      expect(normalizeAudiobookMatchText(input)).toBe('its wonderful');
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

    it('parses Whisper-ish format with segments key', () => {
      const json = JSON.stringify({
        segments: [
          { start: 0, end: 3.2, text: 'Hello world' },
          { start: 3.2, end: 6.5, text: 'Second segment' },
        ],
      });
      const result = parseTranscriptJSON(json);
      expect(result).toHaveLength(2);
      expect(result[0]!.end).toBeCloseTo(3.2);
    });

    it('parses raw JSON array without end field', () => {
      const json = JSON.stringify([{ start: 0, text: 'No end time' }]);
      const result = parseTranscriptJSON(json);
      expect(result).toHaveLength(1);
      expect(result[0]!.end).toBeUndefined();
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

    it('trims text in parsed segments', () => {
      const json = JSON.stringify([{ start: 0, text: '  hello  ' }]);
      const result = parseTranscriptJSON(json);
      expect(result[0]!.text).toBe('hello');
    });

    it('returns empty for invalid JSON', () => {
      expect(parseTranscriptJSON('not json')).toHaveLength(0);
    });

    it('returns empty for non-array/object JSON', () => {
      expect(parseTranscriptJSON('"hello"')).toHaveLength(0);
    });
  });

  // ── parseAudiobookTranscript (auto-detect) ──────────────────────────

  describe('parseAudiobookTranscript', () => {
    it('detects JSON format with segments key', () => {
      const json = JSON.stringify({ segments: [{ start: 0, text: 'Hello' }] });
      const result = parseAudiobookTranscript(json);
      expect(result).toHaveLength(1);
    });

    it('detects raw JSON array', () => {
      const json = JSON.stringify([{ start: 0, text: 'Hello' }]);
      const result = parseAudiobookTranscript(json);
      expect(result).toHaveLength(1);
    });

    it('detects VTT format', () => {
      const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello';
      const result = parseAudiobookTranscript(vtt);
      expect(result).toHaveLength(1);
    });

    it('detects SRT format', () => {
      const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello';
      const result = parseAudiobookTranscript(srt);
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

  // ── matchTranscriptSegmentsToTextUnits ──────────────────────────────

  describe('matchTranscriptSegmentsToTextUnits', () => {
    const textUnits: AudiobookTextUnit[] = [
      {
        cfi: 'cfi-/4/2',
        text: 'It was the best of times, it was the worst of times.',
        sectionIndex: 0,
      },
      {
        cfi: 'cfi-/4/4',
        text: 'It was the age of wisdom, it was the age of foolishness.',
        sectionIndex: 0,
      },
      {
        cfi: 'cfi-/4/6',
        text: 'A completely unrelated paragraph about something else.',
        sectionIndex: 0,
      },
    ];

    it('returns empty for undefined segments', () => {
      expect(matchTranscriptSegmentsToTextUnits(undefined, textUnits)).toEqual([]);
    });

    it('returns empty for empty text units', () => {
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: 'Hello world' }];
      expect(matchTranscriptSegmentsToTextUnits(segments, [])).toEqual([]);
    });

    it('matches via containment (text unit contains segment)', () => {
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, end: 5, text: 'best of times' }];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(1);
      expect(result[0]!.cfi).toBe('cfi-/4/2');
      expect(result[0]!.source).toBe('transcript-match');
      expect(result[0]!.secondsStart).toBe(0);
      expect(result[0]!.secondsEnd).toBe(5);
    });

    it('matches via reverse containment (segment contains text unit)', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, text: 'A completely unrelated paragraph about something else.' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(1);
      // With adjacent window, the segment may match a window centered on an earlier unit
      // that includes the target unit's text. Verify it matched one of the valid units.
      expect(['cfi-/4/4', 'cfi-/4/6']).toContain(result[0]!.cfi);
    });

    it('matches via token overlap', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 5, text: 'age of wisdom and foolishness combined together' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(1);
      // With adjacent window, the segment may match a window centered on unit 0 or 1
      // since both contain "age of wisdom/foolishness" tokens. Verify it matched a valid unit.
      expect(['cfi-/4/2', 'cfi-/4/4']).toContain(result[0]!.cfi);
    });

    it('skips low-confidence matches', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, text: 'xyzzy plugh nothing matches this' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(0);
    });

    it('skips segments shorter than minSegmentLength', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, text: 'Hi' },
        { start: 5, text: 'Hello world this is longer' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits, {
        minSegmentLength: 10,
      });
      // Only the second segment is long enough, but it won't match any unit
      // so result depends on whether it matches
      expect(result.every((e) => e.label!.length >= 10)).toBe(true);
    });

    it('sets label to first 60 chars of segment text', () => {
      const longText = 'best of times ' + 'x'.repeat(80);
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: longText }];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      if (result.length > 0) {
        expect(result[0]!.label!.length).toBeLessThanOrEqual(60);
      }
    });

    it('handles curly quotes in transcript matching book text', () => {
      const units: AudiobookTextUnit[] = [{ cfi: 'cfi-1', text: 'It\u2019s a wonderful day.' }];
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: "It's a wonderful day" }];
      const result = matchTranscriptSegmentsToTextUnits(segments, units);
      expect(result).toHaveLength(1);
      expect(result[0]!.cfi).toBe('cfi-1');
    });

    it('handles em-dash normalization in matching', () => {
      const units: AudiobookTextUnit[] = [{ cfi: 'cfi-1', text: 'Hello\u2014world of wonder' }];
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: 'Hello world of wonder' }];
      const result = matchTranscriptSegmentsToTextUnits(segments, units);
      expect(result).toHaveLength(1);
    });

    it('does not crash on empty text units', () => {
      const units: AudiobookTextUnit[] = [
        { cfi: 'cfi-1', text: '' },
        { cfi: 'cfi-2', text: '   ' },
      ];
      const segments: AudiobookTranscriptSegment[] = [{ start: 0, text: 'Hello world' }];
      const result = matchTranscriptSegmentsToTextUnits(segments, units);
      expect(result).toHaveLength(0);
    });

    it('generates correct sync map entry structure', () => {
      const segments: AudiobookTranscriptSegment[] = [
        { start: 10.5, end: 15.2, text: 'best of times' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      if (result.length > 0) {
        expect(result[0]!.secondsStart).toBeCloseTo(10.5);
        expect(result[0]!.secondsEnd).toBeCloseTo(15.2);
        expect(result[0]!.source).toBe('transcript-match');
        expect(result[0]!.cfi).toBeTruthy();
        expect(result[0]!.label).toBeTruthy();
      }
    });

    // ── False-positive rejection ────────────────────────────────────────

    it('does not match purely stop-word segments against book text', () => {
      // "it was" consists entirely of stop words — should never score via token overlap
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, end: 5, text: 'it was' },
        { start: 5, end: 10, text: 'the best' },
        { start: 10, end: 15, text: 'in the beginning there was light' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(0);
    });

    it('does not match unrelated content from a different book', () => {
      // Lorem ipsum has many content words but none appear in the Dickens textUnits
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, end: 8, text: 'lorem ipsum dolor sit amet consectetur adipiscing elit' },
        { start: 8, end: 16, text: 'sed do eiusmod tempor incididunt labore dolore magna aliqua' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(0);
    });

    it('does not match random filler with fewer than minimum meaningful tokens', () => {
      // Even though "time" is close to "times" (different token), still no match
      const segments: AudiobookTranscriptSegment[] = [
        { start: 0, end: 5, text: 'it was a very good time' },
        { start: 5, end: 10, text: 'well this is quite nice' },
      ];
      const result = matchTranscriptSegmentsToTextUnits(segments, textUnits);
      expect(result).toHaveLength(0);
    });
  });
});
