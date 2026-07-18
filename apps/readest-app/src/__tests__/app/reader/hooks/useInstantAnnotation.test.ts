import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// The instant-highlight start is anchored to a DOM position at pointer-down so
// the highlight survives a page scroll: after a corner auto page-turn the same
// screen coordinates resolve to different content, but the anchored start must
// stay put so the range spans both pages.

const h = vi.hoisted(() => ({
  view: { getCFI: vi.fn(() => 'cfi'), addAnnotation: vi.fn() },
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'highlight',
        highlightStyles: { highlight: '#ffff00' },
      },
    },
  }),
}));
const stores = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  updateBooknotes: vi.fn(() => ({})),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: [] }),
    saveConfig: stores.saveConfig,
    updateBooknotes: stores.updateBooknotes,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewsById: () => [h.view],
    getViewSettings: () => ({
      enableAnnotationQuickActions: true,
      annotationQuickAction: 'highlight',
    }),
    getProgress: () => ({ page: 1 }),
  }),
}));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  toParentViewportPoint: (_doc: Document, x: number, y: number) => ({ x, y }),
}));

import { useInstantAnnotation } from '@/app/reader/hooks/useInstantAnnotation';
import type { TextSelection } from '@/utils/sel';

let p1: HTMLElement;
let p2: HTMLElement;
let t1: Text;
let t2: Text;
// Whether the page has "turned": after a turn the same screen coords resolve to
// page 2's content.
let scrolled = false;

const setup = () => {
  const captured: { selection: TextSelection | null } = { selection: null };
  const setSelection = vi.fn((s: TextSelection | null) => {
    captured.selection = s;
  });
  const setEditingAnnotation = vi.fn();
  const hook = renderHook(() =>
    useInstantAnnotation({
      bookKey: 'book-1',
      getAnnotationText: vi.fn(async () => 'text'),
      setSelection: setSelection as never,
      setEditingAnnotation: setEditingAnnotation as never,
      setExternalDragPoint: vi.fn(),
    }),
  );
  return { ...hook, captured, setSelection, setEditingAnnotation };
};

const pointer = (x: number, y: number) =>
  ({ button: 0, clientX: x, clientY: y }) as unknown as PointerEvent;

beforeEach(() => {
  vi.clearAllMocks();
  scrolled = false;
  p1 = document.createElement('p');
  p1.textContent = 'first page text here';
  p2 = document.createElement('p');
  p2.textContent = 'second page text here';
  document.body.append(p1, p2);
  t1 = p1.firstChild as Text;
  t2 = p2.firstChild as Text;

  // start zone is x < 40, end zone is x >= 40. After a turn both map to page 2.
  (document as unknown as { caretPositionFromPoint: unknown }).caretPositionFromPoint = (
    x: number,
  ) =>
    x < 40
      ? { offsetNode: scrolled ? t2 : t1, offset: 2 }
      : { offsetNode: scrolled ? t2 : t1, offset: 8 };

  // jsdom has no layout: make every range "cover" the point so the selectable-
  // content check passes, and give ranges a measurable box.
  Range.prototype.getClientRects = () =>
    [{ left: 0, right: 1000, top: 0, bottom: 1000 }] as unknown as DOMRectList;
});

afterEach(() => {
  document.body.replaceChildren();
  cleanup();
});

describe('useInstantAnnotation DOM-anchored start', () => {
  test('the start stays anchored to its DOM node across a simulated page turn', () => {
    const { result, captured } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    result.current.handleInstantAnnotationPointerMove(document, 0, pointer(60, 10));
    expect(captured.selection?.range?.startContainer).toBe(t1);
    expect(captured.selection?.range?.endContainer).toBe(t1);

    // The page turns: the same coords now resolve to page 2, but the anchored
    // start must remain on page 1 so the range spans both pages.
    scrolled = true;
    result.current.handleInstantAnnotationPointerMove(document, 0, pointer(60, 10));
    expect(captured.selection?.range?.startContainer).toBe(t1);
    expect(captured.selection?.range?.endContainer).toBe(t2);
  });

  test('reapplyInstantAnnotation rebuilds across the turn from the held position', () => {
    const { result, captured } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    result.current.handleInstantAnnotationPointerMove(document, 0, pointer(60, 10));

    // Finger held still; page turns; re-emit rebuilds onto page 2.
    scrolled = true;
    result.current.reapplyInstantAnnotation();
    expect(captured.selection?.range?.startContainer).toBe(t1);
    expect(captured.selection?.range?.endContainer).toBe(t2);
  });

  test('a barely-moved tap with no preview cancels (returns false)', async () => {
    const { result, setSelection } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    const handled = await result.current.handleInstantAnnotationPointerUp(
      document,
      0,
      pointer(12, 11),
    );

    expect(handled).toBe(false);
    expect(setSelection).toHaveBeenLastCalledWith(null);
  });
});

// A still hold (touch) engages on the word under the finger: the word is
// previewed at engage time (the feedback the suppressed system selection used
// to give), and a release without dragging commits it as a real highlight and
// leaves the annotation range editor open for adjustment — the same state as
// tapping an existing highlight.
describe('useInstantAnnotation hold-a-word engage and commit', () => {
  test('engage draws the word under the pointer as the preview', () => {
    const { result, captured } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    result.current.handleInstantAnnotationEngage(document, 0);

    expect(h.view.addAnnotation).toHaveBeenCalled();
    expect(captured.selection?.annotated).toBe(true);
    expect(captured.selection?.range?.startContainer).toBe(t1);
  });

  test('a hold-release commits the word and opens the editor', async () => {
    const { result, captured, setEditingAnnotation } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    result.current.handleInstantAnnotationEngage(document, 0);
    const handled = await result.current.handleInstantAnnotationPointerUp(
      document,
      0,
      pointer(12, 11),
    );

    expect(handled).toBe('editor');
    // Persisted like a finished instant highlight.
    expect(stores.updateBooknotes).toHaveBeenCalled();
    // Editor state left open: an annotation with a color for the range editor,
    // and a selection carrying the real text (isTextSelected stays false in
    // useTextSelector, so the Annotator shows the options row, not the quick
    // action).
    const editing = setEditingAnnotation.mock.lastCall?.[0];
    expect(editing?.color).toBeTruthy();
    expect(captured.selection?.annotated).toBe(true);
    expect(captured.selection?.text).toBe('text');
  });

  test('a drag after engage still commits and closes (no editor left open)', async () => {
    const { result, setSelection } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    result.current.handleInstantAnnotationEngage(document, 0);
    result.current.handleInstantAnnotationPointerMove(document, 0, pointer(60, 10));
    const handled = await result.current.handleInstantAnnotationPointerUp(
      document,
      0,
      pointer(60, 10),
    );

    expect(handled).toBe(true);
    expect(setSelection).toHaveBeenLastCalledWith(null);
  });

  test('engage without a resolvable word leaves the release a tap', async () => {
    const { result } = setup();

    result.current.handleInstantAnnotationPointerDown(document, 0, pointer(10, 10));
    (document as unknown as { caretPositionFromPoint: unknown }).caretPositionFromPoint = () =>
      null;
    result.current.handleInstantAnnotationEngage(document, 0);
    const handled = await result.current.handleInstantAnnotationPointerUp(
      document,
      0,
      pointer(12, 11),
    );

    expect(handled).toBe(false);
  });
});
