import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';

const h = vi.hoisted(() => ({
  view: { addAnnotation: vi.fn() },
  updateBooknotes: vi.fn(),
  saveConfig: vi.fn(),
  booknotes: [] as BookNote[],
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: h.booknotes }),
    saveConfig: h.saveConfig,
    updateBooknotes: h.updateBooknotes,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewsById: () => [h.view],
  }),
}));

import { useSaveBooknoteNoteText } from '@/app/reader/hooks/useSaveBooknoteNoteText';

// note starts blank so a successful save is a bubble-adding transition —
// that makes "the view was updated" an observable, non-vacuous assertion.
const makeBooknote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.booknotes = [makeBooknote()];
});

afterEach(() => cleanup());

describe('useSaveBooknoteNoteText', () => {
  it('redraws the note bubble and saves the config when the store update succeeds', () => {
    h.updateBooknotes.mockReturnValue({ booknotes: h.booknotes });
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    result.current('note-1', 'new text');

    expect(h.view.addAnnotation).toHaveBeenCalledTimes(1);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('does not touch the view or persist the config when the store update fails', () => {
    h.updateBooknotes.mockReturnValue(undefined);
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    result.current('note-1', 'new text');

    expect(h.updateBooknotes).toHaveBeenCalledTimes(1);
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it('does not call updateBooknotes at all when the target booknote no longer exists', () => {
    h.booknotes = [];
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    result.current('note-1', 'new text');

    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
});
