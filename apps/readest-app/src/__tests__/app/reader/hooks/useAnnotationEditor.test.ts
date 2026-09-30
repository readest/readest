import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';
import type { TextSelection } from '@/utils/sel';

// applyAnnotationRange now takes an already-built (DOM-anchored) range instead of
// resolving both ends from window coordinates, so the edited highlight survives a
// corner auto page-turn. This locks that contract: a commit applies the given
// range's CFI/text; a drag does not persist.

const h = vi.hoisted(() => ({
  view: { getCFI: vi.fn(() => 'new-cfi'), addAnnotation: vi.fn() },
  updateBooknotes: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  annotations: [] as BookNote[],
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: h.annotations }),
    saveConfig: h.saveConfig,
    updateBooknotes: h.updateBooknotes,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewsById: () => [h.view],
    getProgress: () => ({ page: 3 }),
  }),
}));
vi.mock('@/app/reader/utils/annotatorUtil', async () => {
  const actual = await vi.importActual<typeof import('@/app/reader/utils/annotatorUtil')>(
    '@/app/reader/utils/annotatorUtil',
  );
  return { ...actual, getHandlePositionsFromRange: () => null };
});

import { FoliateView, NOTE_PREFIX } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { removeBookNoteOverlays } from '@/app/reader/utils/annotatorUtil';
import { useAnnotationEditor } from '@/app/reader/hooks/useAnnotationEditor';

const annotation = {
  id: 'a1',
  type: 'annotation',
  cfi: 'old-cfi',
  style: 'highlight',
  color: 'yellow',
  text: 'old',
  note: '',
} as unknown as BookNote;

const setup = (
  edited: BookNote = annotation,
  getAnnotationText: (range: Range) => Promise<string> = vi.fn(async () => 'edited text'),
  selection: Partial<TextSelection> = {},
) => {
  const setSelection = vi.fn();
  const hook = renderHook(() =>
    useAnnotationEditor({
      bookKey: 'book-1',
      annotation: edited,
      selection: selection as TextSelection,
      getAnnotationText,
      setSelection: setSelection as never,
    }),
  );
  return { ...hook, setSelection };
};

const range = {} as Range;

beforeEach(() => {
  vi.clearAllMocks();
  h.view.getCFI.mockReset().mockReturnValue('new-cfi');
  h.view.addAnnotation.mockReset();
  h.annotations = [{ ...annotation }];
});

afterEach(() => cleanup());

describe('useAnnotationEditor applyAnnotationRange', () => {
  test('commit applies the given range CFI/text and persists', async () => {
    const { result, setSelection } = setup();

    await result.current.applyAnnotationRange(range, 2, false, false);

    expect(h.view.getCFI).toHaveBeenCalledWith(2, range);
    expect(h.updateBooknotes).toHaveBeenCalledTimes(1);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: 'new-cfi', text: 'edited text', range, annotated: true }),
    );
  });

  // #6390: a range in the footnote popup's document means nothing to the main
  // view's getCFI; the popup's own mapping into the section must place it, and
  // the republished selection must still be known as the popup's.
  test('a footnote popup range is placed by the popup mapping, not the main view', async () => {
    const getPopupCfi = vi.fn(() => 'popup-cfi');
    const { result, setSelection } = setup(annotation, undefined, {
      popup: true,
      href: 'notes.xhtml',
      getPopupCfi,
    });

    await result.current.applyAnnotationRange(range, 2, false, false);

    expect(getPopupCfi).toHaveBeenCalledWith(range);
    expect(h.view.getCFI).not.toHaveBeenCalled();
    expect(h.annotations[0]).toMatchObject({ cfi: 'popup-cfi', text: 'edited text' });
    expect(setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: 'popup-cfi', popup: true, href: 'notes.xhtml', getPopupCfi }),
    );
  });

  // The popup's overlays live in its own view, out of reach of the main views
  // the editor repaints, so the popup is told to redraw the moving range.
  test('a footnote popup drag asks the popup to redraw the preview', async () => {
    const onPreview = vi.fn();
    eventDispatcher.on('footnote-annotation-preview', onPreview);
    const { result } = setup(annotation, undefined, {
      popup: true,
      getPopupCfi: () => 'popup-cfi',
    });

    await result.current.applyAnnotationRange(range, 2, false, true);
    eventDispatcher.off('footnote-annotation-preview', onPreview);

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { key: 'book-1', note: expect.objectContaining({ id: 'a1', cfi: 'popup-cfi' }) },
      }),
    );
  });

  test('a drag (isDragging) updates the preview but does not persist', async () => {
    const { result, setSelection } = setup();

    await result.current.applyAnnotationRange(range, 2, false, true);

    expect(h.view.addAnnotation).toHaveBeenCalled();
    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
  });

  test.each([
    true,
    false,
  ])('a late range result cannot replace a newer commit (isDragging=%s)', async (isDragging) => {
    const noted = { ...annotation, note: 'my note' } as BookNote;
    h.annotations = [{ ...noted }];
    const overlays = new Set([noted.cfi, `${NOTE_PREFIX}${noted.cfi}`]);
    h.view.addAnnotation.mockImplementation(
      (note: BookNote & { value?: string }, remove = false) => {
        const value = note.value ?? note.cfi;
        if (remove) overlays.delete(value);
        else overlays.add(value);
      },
    );
    h.view.getCFI.mockReturnValueOnce('stale-cfi').mockReturnValueOnce('committed-cfi');
    const pending = Promise.withResolvers<string>();
    const { result, setSelection } = setup(
      noted,
      vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('committed text'),
    );

    const stale = result.current.applyAnnotationRange(range, 2, false, isDragging);
    await result.current.applyAnnotationRange(range, 2, false, false);
    pending.resolve('stale text');
    await stale;

    expect(h.annotations[0]).toMatchObject({ cfi: 'committed-cfi', text: 'committed text' });
    expect(h.updateBooknotes).toHaveBeenCalledTimes(1);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: 'committed-cfi', text: 'committed text' }),
    );
    expect(overlays).toEqual(new Set(['committed-cfi', `${NOTE_PREFIX}committed-cfi`]));

    // Deleting the saved record must also remove everything painted for it.
    // A late preview used to leave its stale CFI outside this cleanup (#6141).
    removeBookNoteOverlays(h.view as unknown as FoliateView, h.annotations[0]!);
    expect(overlays.size).toBe(0);
  });

  test('an older drag cannot rewind a newer preview', async () => {
    h.view.getCFI.mockReturnValueOnce('stale-cfi').mockReturnValueOnce('latest-cfi');
    const pending = Promise.withResolvers<string>();
    const { result } = setup(
      annotation,
      vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('latest text'),
    );

    const stale = result.current.applyAnnotationRange(range, 2, false, true);
    await result.current.applyAnnotationRange(range, 2, false, true);
    pending.resolve('stale text');
    await stale;

    expect(h.view.addAnnotation).toHaveBeenLastCalledWith(
      expect.objectContaining({ cfi: 'latest-cfi', text: 'latest text' }),
    );
    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  // Adjusting the boundaries of a highlight that carries a note moves the record
  // to a new CFI, and both of its overlays are keyed by that CFI. Tearing down
  // only the highlight overlay left the note bubble stranded at the old anchor
  // while a fresh one was drawn at the new one, so a single highlight ended up
  // showing several note markers — and the stale ones resolved to no record at
  // all when clicked (#5538).
  test('re-anchors the note bubble overlay instead of stranding it at the old cfi', async () => {
    const noted = { ...annotation, note: 'my note' } as BookNote;
    h.annotations = [{ ...noted }];
    const { result } = setup(noted);

    await result.current.applyAnnotationRange(range, 2, false, false);

    const calls = h.view.addAnnotation.mock.calls as [BookNote & { value?: string }, boolean?][];
    const bubbleCalls = calls.filter(([note]) => note.value?.startsWith(NOTE_PREFIX));
    expect(bubbleCalls).toContainEqual([
      expect.objectContaining({ value: `${NOTE_PREFIX}old-cfi` }),
      true,
    ]);
    expect(bubbleCalls).toContainEqual([
      expect.objectContaining({ value: `${NOTE_PREFIX}new-cfi` }),
    ]);
  });

  // While a handle is held, the saved record still holds the range from before
  // the drag, and the reader repaints saved records whenever it relocates (a
  // corner auto page-turn, a resize). That repaint drew the pre-drag range next
  // to the preview, and since the editor only removed its own previous preview,
  // it stayed painted after the highlight was deleted: an untappable ghost that
  // lasted until the book was reopened (#6141).
  test.each([
    ['highlight', ''],
    ['highlight with a note', 'my note'],
  ])('a repaint of the saved range mid-drag does not outlive the %s', async (_, note) => {
    const saved = { ...annotation, note } as BookNote;
    h.annotations = [{ ...saved }];
    const overlays = new Set<string>();
    h.view.addAnnotation.mockImplementation((n: BookNote & { value?: string }, remove = false) => {
      const value = n.value ?? n.cfi;
      if (remove) overlays.delete(value);
      else overlays.add(value);
    });
    const repaintSaved = () => {
      const record = h.annotations[0]!;
      overlays.add(record.cfi);
      if (record.note) overlays.add(`${NOTE_PREFIX}${record.cfi}`);
    };
    repaintSaved();
    h.view.getCFI
      .mockReturnValueOnce('preview-cfi')
      .mockReturnValueOnce('drag-cfi')
      .mockReturnValueOnce('committed-cfi');
    const { result } = setup(saved);

    await result.current.applyAnnotationRange(range, 2, false, true);
    repaintSaved(); // relocate while the handle is held
    await result.current.applyAnnotationRange(range, 2, false, true);
    await result.current.applyAnnotationRange(range, 2, false, false);

    const expected = note ? ['committed-cfi', `${NOTE_PREFIX}committed-cfi`] : ['committed-cfi'];
    expect(overlays).toEqual(new Set(expected));
    removeBookNoteOverlays(h.view as unknown as FoliateView, h.annotations[0]!);
    expect(overlays.size).toBe(0);
  });
});
