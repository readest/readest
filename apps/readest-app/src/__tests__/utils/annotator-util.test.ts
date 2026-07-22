import { describe, it, expect, vi } from 'vitest';
import {
  buildTTSSentenceHighlight,
  getExternalDragHandle,
  getHighlightColorLabel,
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
  toParentViewportPoint,
} from '@/app/reader/utils/annotatorUtil';
import { Point } from '@/utils/sel';
import { BookNote, HighlightColor, HighlightStyle, UserHighlightColor } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { FoliateView, NOTE_PREFIX } from '@/types/view';

describe('getExternalDragHandle', () => {
  const currentStart: Point = { x: 100, y: 200 };
  const currentEnd: Point = { x: 300, y: 200 };

  it('forward drag — externalDragPoint closer to end → returns end', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 280, y: 200 });
    expect(result).toBe('end');
  });

  it('backward drag — externalDragPoint closer to start → returns start', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 120, y: 200 });
    expect(result).toBe('start');
  });

  it('returns null when externalDragPoint is null', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, null);
    expect(result).toBeNull();
  });

  it('returns null when externalDragPoint is undefined', () => {
    const result = getExternalDragHandle(currentStart, currentEnd);
    expect(result).toBeNull();
  });

  it('vertical text — works with vertical coordinates', () => {
    const vStart: Point = { x: 200, y: 100 };
    const vEnd: Point = { x: 200, y: 400 };
    const result = getExternalDragHandle(vStart, vEnd, { x: 200, y: 350 });
    expect(result).toBe('end');
  });

  it('equal distance — returns end (deterministic tie-breaking)', () => {
    // Midpoint between start(100,200) and end(300,200) is (200,200)
    // distToStart === distToEnd, so !(distToStart < distToEnd) → returns 'end'
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 200, y: 200 });
    expect(result).toBe('end');
  });
});

describe('toParentViewportPoint', () => {
  it('adds frameRect offset to coordinates', () => {
    const mockFrameElement = {
      getBoundingClientRect: vi.fn(() => ({
        top: 50,
        left: 80,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      })),
    };
    const doc = {
      defaultView: {
        frameElement: mockFrameElement,
      },
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 100, 200);
    expect(result).toEqual({ x: 180, y: 250 });
  });

  it('defaults to {0,0} offset when no frameElement (detached doc)', () => {
    const doc = {
      defaultView: null,
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 100, 200);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('handles non-zero iframe offset (e.g., sidebar shifts iframe right)', () => {
    const mockFrameElement = {
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 250,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      })),
    };
    const doc = {
      defaultView: {
        frameElement: mockFrameElement,
      },
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 50, 100);
    expect(result).toEqual({ x: 300, y: 100 });
  });
});

describe('getHighlightColorLabel', () => {
  const makeSettings = (
    userHighlightColors: UserHighlightColor[],
    defaultHighlightLabels: Partial<Record<string, string>> = {},
  ): SystemSettings =>
    ({
      globalReadSettings: {
        userHighlightColors,
        defaultHighlightLabels,
      },
    }) as SystemSettings;

  it('returns the user-set label for a built-in color', () => {
    const settings = makeSettings([], { yellow: 'Foreshadowing' });
    expect(getHighlightColorLabel(settings, 'yellow')).toBe('Foreshadowing');
  });

  it('returns the user-set label for a hex color, matching case-insensitively', () => {
    const settings = makeSettings([{ hex: '#aabbcc', label: 'Romance' }]);
    expect(getHighlightColorLabel(settings, '#AABBCC')).toBe('Romance');
  });

  it('returns undefined when the user has not set a label', () => {
    const settings = makeSettings([]);
    expect(getHighlightColorLabel(settings, 'green')).toBeUndefined();
    expect(getHighlightColorLabel(settings, '#123456')).toBeUndefined();
  });

  it('ignores labels that collapse to whitespace', () => {
    const settings = makeSettings([{ hex: '#abcdef', label: '   ' }], { red: '  ' });
    expect(getHighlightColorLabel(settings, '#abcdef')).toBeUndefined();
    expect(getHighlightColorLabel(settings, 'red')).toBeUndefined();
  });
});

describe('removeBookNoteOverlays', () => {
  const makeView = () => {
    const addAnnotation = vi.fn();
    const view = { addAnnotation } as unknown as FoliateView;
    return { view, addAnnotation };
  };

  const baseNote = (overrides: Partial<BookNote> = {}): BookNote => ({
    id: 'id-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2)',
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  it('removes only the highlight overlay for a highlight-only annotation', () => {
    const { view, addAnnotation } = makeView();
    const note = baseNote({ style: 'highlight', color: 'yellow' });

    removeBookNoteOverlays(view, note);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation).toHaveBeenCalledWith(expect.objectContaining({ value: note.cfi }), true);
    const passed = addAnnotation.mock.calls[0]![0] as BookNote & { value: string };
    expect(passed.value.startsWith(NOTE_PREFIX)).toBe(false);
  });

  it('removes only the note overlay for a note-only annotation', () => {
    const { view, addAnnotation } = makeView();
    const note = baseNote({ note: 'my comment' });

    removeBookNoteOverlays(view, note);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: `${NOTE_PREFIX}${note.cfi}` }),
      true,
    );
  });

  it('removes both overlays when the annotation has a highlight and a note', () => {
    const { view, addAnnotation } = makeView();
    const note = baseNote({ style: 'underline', color: 'red', note: 'my comment' });

    removeBookNoteOverlays(view, note);

    expect(addAnnotation).toHaveBeenCalledTimes(2);
    const values = addAnnotation.mock.calls.map(
      (call) => (call[0] as BookNote & { value: string }).value,
    );
    expect(values).toContain(note.cfi);
    expect(values).toContain(`${NOTE_PREFIX}${note.cfi}`);
    for (const call of addAnnotation.mock.calls) {
      expect(call[1]).toBe(true);
    }
  });

  it('does nothing for a bookmark (no highlight, no note text)', () => {
    const { view, addAnnotation } = makeView();
    const bookmark = baseNote({ type: 'bookmark' });

    removeBookNoteOverlays(view, bookmark);

    expect(addAnnotation).not.toHaveBeenCalled();
  });

  it('treats whitespace-only note text as empty and skips the note overlay', () => {
    const { view, addAnnotation } = makeView();
    const note = baseNote({ style: 'highlight', note: '   \n  ' });

    removeBookNoteOverlays(view, note);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation).toHaveBeenCalledWith(expect.objectContaining({ value: note.cfi }), true);
  });

  it('is a no-op when view is null', () => {
    expect(() => removeBookNoteOverlays(null, baseNote({ style: 'highlight' }))).not.toThrow();
  });
});

describe('removeEmptyAnnotationPlaceholder', () => {
  const baseNote = (overrides: Partial<BookNote> = {}): BookNote => ({
    id: 'ph-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2)',
    style: 'highlight',
    color: 'yellow',
    text: 'selected text',
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  it('tombstones the empty placeholder by id and returns it', () => {
    const placeholder = baseNote();
    const booknotes = [placeholder];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBe(placeholder);
    expect(booknotes[0]!.deletedAt).toBe(1234);
  });

  it('returns null and leaves booknotes untouched when the record carries note text', () => {
    const saved = baseNote({ note: 'a real note' });
    const booknotes = [saved];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBeNull();
    expect(booknotes[0]!.deletedAt).toBeUndefined();
  });

  it('treats whitespace-only note text as empty and tombstones it', () => {
    const placeholder = baseNote({ note: '   \n  ' });
    const booknotes = [placeholder];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBe(placeholder);
    expect(booknotes[0]!.deletedAt).toBe(1234);
  });

  it('returns null when no record matches the id', () => {
    const booknotes = [baseNote({ id: 'other' })];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBeNull();
    expect(booknotes[0]!.deletedAt).toBeUndefined();
  });

  it('returns null when the matching record is already soft-deleted', () => {
    const booknotes = [baseNote({ deletedAt: 5 })];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBeNull();
  });

  it('ignores a non-annotation record with the same id', () => {
    const bookmark = baseNote({ type: 'bookmark', style: undefined });
    const booknotes = [bookmark];

    const removed = removeEmptyAnnotationPlaceholder(booknotes, 'ph-1', 1234);

    expect(removed).toBeNull();
    expect(booknotes[0]!.deletedAt).toBeUndefined();
  });
});

describe('buildTTSSentenceHighlight', () => {
  const params = {
    cfi: 'epubcfi(/6/4!/4/10,/1:0,/1:42)',
    text: 'A spoken sentence.',
    style: 'highlight' as HighlightStyle,
    color: 'yellow' as HighlightColor,
    page: 7,
  };

  it('builds an annotation BookNote when none exists at the cfi', () => {
    const note = buildTTSSentenceHighlight([], params, 1000);
    expect(note).not.toBeNull();
    expect(note).toMatchObject({
      type: 'annotation',
      cfi: params.cfi,
      text: params.text,
      style: 'highlight',
      color: 'yellow',
      page: 7,
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(typeof note!.id).toBe('string');
    expect(note!.id.length).toBeGreaterThan(0);
  });

  it('returns null (skip) when a live annotation already exists at the cfi', () => {
    const existing: BookNote = {
      id: 'a1',
      type: 'annotation',
      cfi: params.cfi,
      style: 'highlight',
      color: 'red',
      text: params.text,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(buildTTSSentenceHighlight([existing], params, 1000)).toBeNull();
  });

  it('builds when the only note at the cfi is soft-deleted', () => {
    const deleted: BookNote = {
      id: 'a1',
      type: 'annotation',
      cfi: params.cfi,
      style: 'highlight',
      color: 'red',
      text: params.text,
      note: '',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 5,
    };
    expect(buildTTSSentenceHighlight([deleted], params, 1000)).not.toBeNull();
  });

  it('builds when the note at the cfi is a non-annotation (bookmark)', () => {
    const bookmark: BookNote = {
      id: 'b1',
      type: 'bookmark',
      cfi: params.cfi,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(buildTTSSentenceHighlight([bookmark], params, 1000)).not.toBeNull();
  });
});
