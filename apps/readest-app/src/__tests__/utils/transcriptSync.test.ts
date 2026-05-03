import { describe, it, expect, vi } from 'vitest';
import {
  normalizeForSpotMatch,
  parseSRT,
  parseVTT,
  parseTranscriptJSON,
  parseTranscript,
  normalizeTranscriptSegments,
  buildSyncMapFromTranscript,
  selectBestSpotMatch,
  extractTextUnitsFromWholeBook,
  extractTextUnitsFromVisibleSections,
} from '@/utils/transcriptSync';
import { AudiobookTranscriptSegment, BookSearchMatch } from '@/types/book';
import { SectionItem } from '@/libs/document';

/** Helper: create a minimal Document with given body HTML */
function createDoc(bodyHTML: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(
    `<!DOCTYPE html><html><body>${bodyHTML}</body></html>`,
    'text/html',
  );
}

/** Helper: create a mock SectionItem that returns a fixed Document */
function mockSection(bodyHTML: string, linear = 'yes'): SectionItem {
  const doc = createDoc(bodyHTML);
  return {
    id: `section-${Math.random().toString(36).slice(2)}`,
    cfi: '',
    size: 100,
    linear,
    createDocument: vi.fn().mockResolvedValue(doc),
  } as unknown as SectionItem;
}

/** Helper: create a mock SectionItem that rejects createDocument */
function failingSection(): SectionItem {
  return {
    id: 'fail',
    cfi: '',
    size: 0,
    linear: 'yes',
    createDocument: vi.fn().mockRejectedValue(new Error('load failed')),
  } as unknown as SectionItem;
}

/** Helper: create a mock SectionItem without createDocument */
function noDocSection(): SectionItem {
  return {
    id: 'nodoc',
    cfi: '',
    size: 0,
    linear: 'yes',
  } as unknown as SectionItem;
}

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

  // ── extractTextUnitsFromWholeBook ──────────────────────────────────

  describe('extractTextUnitsFromWholeBook', () => {
    it('extracts text units from readable blocks across sections', async () => {
      const sections = [
        mockSection('<p>Hello world</p><p>Second paragraph</p>'),
        mockSection('<p>Third section text</p>'),
      ];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.sectionsScanned).toBe(2);
      expect(result.sectionsSkipped).toBe(0);
      expect(result.units).toHaveLength(3);
      expect(result.units[0]!.text).toBe('Hello world');
      expect(result.units[1]!.text).toBe('Second paragraph');
      expect(result.units[2]!.text).toBe('Third section text');
      expect(result.units.every((u) => u.cfi === 'cfi-mock')).toBe(true);
    });

    it('skips non-linear sections', async () => {
      const sections = [
        mockSection('<p>Content</p>', 'yes'),
        mockSection('<p>Cover</p>', 'no'),
        mockSection('<p>More content</p>', 'yes'),
      ];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.sectionsScanned).toBe(2);
      expect(result.sectionsSkipped).toBe(1);
      expect(result.units).toHaveLength(2);
    });

    it('skips sections without createDocument', async () => {
      const sections = [noDocSection(), mockSection('<p>Valid</p>')];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.sectionsScanned).toBe(1);
      expect(result.sectionsSkipped).toBe(1);
    });

    it('skips sections where createDocument throws', async () => {
      const sections = [failingSection(), mockSection('<p>Valid</p>')];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.sectionsScanned).toBe(1);
      expect(result.sectionsSkipped).toBe(1);
    });

    it('skips empty and very short text blocks', async () => {
      const sections = [mockSection('<p></p><p>ab</p><p>Real content here</p>')];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      // "ab" is 2 chars < MIN_TEXT_LENGTH(3), empty is 0
      expect(result.units).toHaveLength(1);
      expect(result.units[0]!.text).toBe('Real content here');
    });

    it('skips media-only blocks', async () => {
      // <p><img/></p> has no text nodes and only img child → media-only, skipped
      // <p>Text with image <img/> and words</p> has text nodes + img → not media-only, kept
      const sections = [
        mockSection('<p><img src="x.png"/></p><p>Text with image <img src="y.png"/> and words</p>'),
      ];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      // First p: no text content (img is void, textContent is empty) → filtered by MIN_TEXT_LENGTH
      // Second p: has text nodes + img child → not media-only, kept
      expect(result.units).toHaveLength(1);
      expect(result.units[0]!.text).toContain('Text with image');
    });

    it('skips blocks where getCFI returns empty', async () => {
      const sections = [mockSection('<p>Valid</p><p>No CFI</p>')];
      let callCount = 0;
      const view = {
        book: { sections },
        getCFI: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 2 ? '' : 'cfi-mock';
        }),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.units).toHaveLength(1);
    });

    it('skips blocks where getCFI throws', async () => {
      const sections = [mockSection('<p>Valid</p><p>Throws</p>')];
      let callCount = 0;
      const view = {
        book: { sections },
        getCFI: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) throw new Error('CFI failed');
          return 'cfi-mock';
        }),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.units).toHaveLength(1);
    });

    it('sets sectionIndex correctly for each section', async () => {
      const sections = [
        mockSection('<p>Section zero</p>'),
        noDocSection(), // index 1, skipped
        mockSection('<p>Section two</p>'),
      ];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.units).toHaveLength(2);
      expect(result.units[0]!.sectionIndex).toBe(0);
      expect(result.units[1]!.sectionIndex).toBe(2);
    });

    it('returns empty for book with no sections', async () => {
      const view = {
        book: { sections: [] },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.units).toHaveLength(0);
      expect(result.sectionsScanned).toBe(0);
    });

    it('extracts headings and list items', async () => {
      const sections = [mockSection('<h1>Chapter 1</h1><p>Some text</p><li>List item</li>')];
      const view = {
        book: { sections },
        getCFI: vi.fn().mockReturnValue('cfi-mock'),
      };

      const result = await extractTextUnitsFromWholeBook(view);
      expect(result.units).toHaveLength(3);
      expect(result.units.map((u) => u.text)).toEqual(['Chapter 1', 'Some text', 'List item']);
    });
  });

  // ── extractTextUnitsFromVisibleSections ─────────────────────────────

  describe('extractTextUnitsFromVisibleSections', () => {
    it('extracts from visible renderer contents', () => {
      const doc1 = createDoc('<p>Visible paragraph</p>');
      const doc2 = createDoc('<p>Another visible</p>');

      const view = {
        renderer: {
          getContents: vi.fn().mockReturnValue([
            { doc: doc1, index: 0 },
            { doc: doc2, index: 1 },
          ]),
        },
        getCFI: vi.fn().mockReturnValue('cfi-visible'),
      };

      const result = extractTextUnitsFromVisibleSections(view);
      expect(result).toHaveLength(2);
      expect(result[0]!.text).toBe('Visible paragraph');
      expect(result[1]!.text).toBe('Another visible');
    });

    it('returns empty when no contents loaded', () => {
      const view = {
        renderer: { getContents: vi.fn().mockReturnValue([]) },
        getCFI: vi.fn().mockReturnValue('cfi'),
      };

      const result = extractTextUnitsFromVisibleSections(view);
      expect(result).toHaveLength(0);
    });

    it('skips short and empty text', () => {
      const doc = createDoc('<p></p><p>ab</p><p>Valid text here</p>');
      const view = {
        renderer: { getContents: vi.fn().mockReturnValue([{ doc, index: 0 }]) },
        getCFI: vi.fn().mockReturnValue('cfi'),
      };

      const result = extractTextUnitsFromVisibleSections(view);
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('Valid text here');
    });
  });
});
