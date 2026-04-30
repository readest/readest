import { describe, it, expect, vi } from 'vitest';
import {
  getExternalDragHandle,
  getHighlightColorLabel,
  removeBookNoteOverlays,
  toParentViewportPoint,
} from '@/app/reader/utils/annotatorUtil';
import { Point } from '@/utils/sel';
import { BookNote, UserHighlightColor } from '@/types/book';
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
