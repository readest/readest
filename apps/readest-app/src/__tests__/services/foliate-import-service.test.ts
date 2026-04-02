import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFoliateDataPath,
  mapFoliateColor,
  convertFoliateAnnotation,
  convertFoliateBookmark,
  convertFoliateData,
  parseFoliateData,
  FoliateAnnotation,
  FoliateData,
} from '@/services/annotation/providers/foliate';
import { mergeBookConfigs } from '@/services/backupService';
import { BookConfig, BookNote } from '@/types/book';

const BOOK_HASH = 'abc123';

// Freeze Date.now for deterministic tests
const NOW = 1700000000000;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('getFoliateDataPath', () => {
  it('should construct path with encoded identifier', () => {
    const result = getFoliateDataPath('/home/user/.local/share', 'urn:isbn:9780123456789');
    expect(result).toBe(
      '/home/user/.local/share/com.github.johnfactotum.Foliate/urn%3Aisbn%3A9780123456789.json',
    );
  });

  it('should handle identifiers with special characters', () => {
    const result = getFoliateDataPath('/data', 'http://example.com/book?id=1&v=2');
    expect(result).toBe(
      '/data/com.github.johnfactotum.Foliate/http%3A%2F%2Fexample.com%2Fbook%3Fid%3D1%26v%3D2.json',
    );
  });

  it('should handle simple identifier', () => {
    const result = getFoliateDataPath('/data', 'simple-id');
    expect(result).toBe('/data/com.github.johnfactotum.Foliate/simple-id.json');
  });
});

describe('mapFoliateColor', () => {
  it('should map yellow to highlight/yellow', () => {
    expect(mapFoliateColor('yellow')).toEqual({ style: 'highlight', color: 'yellow' });
  });

  it('should map orange to highlight/yellow', () => {
    expect(mapFoliateColor('orange')).toEqual({ style: 'highlight', color: 'yellow' });
  });

  it('should map red to highlight/red', () => {
    expect(mapFoliateColor('red')).toEqual({ style: 'highlight', color: 'red' });
  });

  it('should map magenta to highlight/violet', () => {
    expect(mapFoliateColor('magenta')).toEqual({ style: 'highlight', color: 'violet' });
  });

  it('should map aqua to highlight/blue', () => {
    expect(mapFoliateColor('aqua')).toEqual({ style: 'highlight', color: 'blue' });
  });

  it('should map lime to highlight/green', () => {
    expect(mapFoliateColor('lime')).toEqual({ style: 'highlight', color: 'green' });
  });

  it('should map underline to underline/red', () => {
    expect(mapFoliateColor('underline')).toEqual({ style: 'underline', color: 'red' });
  });

  it('should map squiggly to squiggly/red', () => {
    expect(mapFoliateColor('squiggly')).toEqual({ style: 'squiggly', color: 'red' });
  });

  it('should map strikethrough to highlight/red', () => {
    expect(mapFoliateColor('strikethrough')).toEqual({ style: 'highlight', color: 'red' });
  });

  it('should default undefined to highlight/yellow', () => {
    expect(mapFoliateColor(undefined)).toEqual({ style: 'highlight', color: 'yellow' });
  });

  it('should pass through custom hex color', () => {
    expect(mapFoliateColor('#ff5500')).toEqual({ style: 'highlight', color: '#ff5500' });
  });
});

describe('convertFoliateAnnotation', () => {
  it('should convert a full annotation', () => {
    const annotation: FoliateAnnotation = {
      value: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      text: 'highlighted text',
      color: 'aqua',
      note: 'my note',
      created: '2024-01-15T10:30:00Z',
      modified: '2024-01-16T12:00:00Z',
    };
    const result = convertFoliateAnnotation(BOOK_HASH, annotation);

    expect(result.type).toBe('annotation');
    expect(result.cfi).toBe('epubcfi(/6/4!/4/2,/1:0,/1:10)');
    expect(result.text).toBe('highlighted text');
    expect(result.style).toBe('highlight');
    expect(result.color).toBe('blue');
    expect(result.note).toBe('my note');
    expect(result.createdAt).toBe(new Date('2024-01-15T10:30:00Z').getTime());
    expect(result.updatedAt).toBe(new Date('2024-01-16T12:00:00Z').getTime());
    expect(result.id).toBeTruthy();
  });

  it('should produce stable IDs for the same CFI', () => {
    const annotation: FoliateAnnotation = { value: 'epubcfi(/6/4!/4/2,/1:0,/1:10)' };
    const first = convertFoliateAnnotation(BOOK_HASH, annotation);
    const second = convertFoliateAnnotation(BOOK_HASH, annotation);
    expect(first.id).toBe(second.id);
  });

  it('should produce different IDs for different CFIs', () => {
    const a = convertFoliateAnnotation(BOOK_HASH, { value: 'cfi-a' });
    const b = convertFoliateAnnotation(BOOK_HASH, { value: 'cfi-b' });
    expect(a.id).not.toBe(b.id);
  });

  it('should handle missing optional fields', () => {
    const annotation: FoliateAnnotation = {
      value: 'epubcfi(/6/4)',
    };
    const result = convertFoliateAnnotation(BOOK_HASH, annotation);

    expect(result.text).toBe('');
    expect(result.note).toBe('');
    expect(result.style).toBe('highlight');
    expect(result.color).toBe('yellow');
    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
  });

  it('should fall back to Date.now() for invalid dates', () => {
    const annotation: FoliateAnnotation = {
      value: 'cfi',
      created: 'not-a-date',
      modified: 'also-invalid',
    };
    const result = convertFoliateAnnotation(BOOK_HASH, annotation);

    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
  });
});

describe('convertFoliateBookmark', () => {
  it('should create a bookmark-type note', () => {
    const result = convertFoliateBookmark(BOOK_HASH, 'epubcfi(/6/8!/4/2)');

    expect(result.type).toBe('bookmark');
    expect(result.cfi).toBe('epubcfi(/6/8!/4/2)');
    expect(result.note).toBe('');
    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
    expect(result.id).toBeTruthy();
  });

  it('should produce stable IDs for the same CFI', () => {
    const first = convertFoliateBookmark(BOOK_HASH, 'epubcfi(/6/8!/4/2)');
    const second = convertFoliateBookmark(BOOK_HASH, 'epubcfi(/6/8!/4/2)');
    expect(first.id).toBe(second.id);
  });

  it('should produce different IDs from annotations with the same CFI', () => {
    const bookmark = convertFoliateBookmark(BOOK_HASH, 'cfi-same');
    const annotation = convertFoliateAnnotation(BOOK_HASH, { value: 'cfi-same' });
    expect(bookmark.id).not.toBe(annotation.id);
  });
});

describe('convertFoliateData', () => {
  it('should convert full data with annotations and bookmarks', () => {
    const data: FoliateData = {
      annotations: [
        { value: 'cfi-1', text: 'text1', color: 'yellow' },
        { value: 'cfi-2', text: 'text2', color: 'red', note: 'note2' },
      ],
      bookmarks: ['cfi-bm-1', 'cfi-bm-2'],
      progress: [42, 100],
      lastLocation: 'cfi-last',
    };
    const result = convertFoliateData(BOOK_HASH, data);

    expect(result.booknotes).toHaveLength(4);
    expect(result.booknotes!.filter((n) => n.type === 'annotation')).toHaveLength(2);
    expect(result.booknotes!.filter((n) => n.type === 'bookmark')).toHaveLength(2);
    expect(result.progress).toEqual([42, 100]);
    expect(result.location).toBe('cfi-last');
  });

  it('should handle empty arrays', () => {
    const data: FoliateData = {
      annotations: [],
      bookmarks: [],
    };
    const result = convertFoliateData(BOOK_HASH, data);

    expect(result.booknotes).toEqual([]);
    expect(result.progress).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it('should handle missing fields', () => {
    const data: FoliateData = {};
    const result = convertFoliateData(BOOK_HASH, data);

    expect(result.booknotes).toEqual([]);
    expect(result.progress).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it('should handle only bookmarks', () => {
    const data: FoliateData = { bookmarks: ['cfi-1'] };
    const result = convertFoliateData(BOOK_HASH, data);

    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.type).toBe('bookmark');
  });

  it('should handle only progress', () => {
    const data: FoliateData = { progress: [10, 200] };
    const result = convertFoliateData(BOOK_HASH, data);

    expect(result.booknotes).toEqual([]);
    expect(result.progress).toEqual([10, 200]);
  });
});

describe('parseFoliateData', () => {
  it('should parse valid JSON', () => {
    const json = JSON.stringify({
      annotations: [{ value: 'cfi-1', text: 'hello' }],
      bookmarks: ['cfi-2'],
      progress: [5, 100],
    });
    const result = parseFoliateData(json);

    expect(result).not.toBeNull();
    expect(result!.annotations).toHaveLength(1);
    expect(result!.bookmarks).toHaveLength(1);
    expect(result!.progress).toEqual([5, 100]);
  });

  it('should return null for invalid JSON', () => {
    expect(parseFoliateData('not json')).toBeNull();
  });

  it('should return null for non-object JSON (array)', () => {
    expect(parseFoliateData('[1, 2, 3]')).toBeNull();
  });

  it('should return null for non-object JSON (string)', () => {
    expect(parseFoliateData('"hello"')).toBeNull();
  });

  it('should return null for null JSON', () => {
    expect(parseFoliateData('null')).toBeNull();
  });

  it('should handle empty object', () => {
    const result = parseFoliateData('{}');
    expect(result).not.toBeNull();
    expect(result).toEqual({});
  });
});

describe('integration: merge converted Foliate data with existing config', () => {
  it('should merge Foliate notes with existing config notes', () => {
    const existingNote: BookNote = {
      id: 'existing-1',
      type: 'annotation',
      cfi: 'existing-cfi',
      note: 'existing note',
      createdAt: 100,
      updatedAt: 100,
    };
    const currentConfig: Partial<BookConfig> = {
      progress: [50, 200],
      booknotes: [existingNote],
      updatedAt: 500,
    };

    const foliateData: FoliateData = {
      annotations: [{ value: 'foliate-cfi', text: 'foliate text', color: 'lime' }],
      bookmarks: ['bookmark-cfi'],
      progress: [30, 200],
    };
    const converted = convertFoliateData(BOOK_HASH, foliateData);
    const merged = mergeBookConfigs(currentConfig, converted);

    // Should keep higher progress from current (50 > 30)
    expect(merged.progress).toEqual([50, 200]);
    // Should have all notes: 1 existing + 1 annotation + 1 bookmark = 3
    expect(merged.booknotes).toHaveLength(3);
    expect(merged.booknotes!.find((n) => n.id === 'existing-1')).toBeDefined();
    expect(merged.booknotes!.filter((n) => n.type === 'bookmark')).toHaveLength(1);
  });

  it('should use Foliate progress when higher', () => {
    const currentConfig: Partial<BookConfig> = {
      progress: [10, 200],
      updatedAt: 500,
    };
    const foliateData: FoliateData = {
      progress: [80, 200],
      lastLocation: 'foliate-loc',
    };
    const converted = convertFoliateData(BOOK_HASH, foliateData);
    const merged = mergeBookConfigs(currentConfig, converted);

    expect(merged.progress).toEqual([80, 200]);
    expect(merged.location).toBe('foliate-loc');
  });
});
