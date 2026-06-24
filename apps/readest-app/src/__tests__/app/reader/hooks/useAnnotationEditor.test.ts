import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';

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
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHandlePositionsFromRange: () => null,
}));

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

const setup = () => {
  const setSelection = vi.fn();
  const hook = renderHook(() =>
    useAnnotationEditor({
      bookKey: 'book-1',
      annotation,
      getAnnotationText: vi.fn(async () => 'edited text'),
      setSelection: setSelection as never,
    }),
  );
  return { ...hook, setSelection };
};

const range = {} as Range;

beforeEach(() => {
  vi.clearAllMocks();
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

  test('a drag (isDragging) updates the preview but does not persist', async () => {
    const { result, setSelection } = setup();

    await result.current.applyAnnotationRange(range, 2, false, true);

    expect(h.view.addAnnotation).toHaveBeenCalled();
    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
  });
});
