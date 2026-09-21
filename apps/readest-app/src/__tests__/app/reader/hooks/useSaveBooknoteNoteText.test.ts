import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';

const h = vi.hoisted(() => ({
  view: { addAnnotation: vi.fn() },
  updateBooknotes: vi.fn(),
  saveConfig: vi.fn(),
  booknotes: [] as BookNote[],
  toast: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: h.toast } }));

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
  vi.resetAllMocks();
  h.booknotes = [makeBooknote()];
});

afterEach(() => cleanup());

describe('useSaveBooknoteNoteText', () => {
  it('redraws the note bubble and saves the config when the store update succeeds', async () => {
    h.updateBooknotes.mockReturnValue({ booknotes: h.booknotes });
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    await result.current('note-1', 'new text');

    expect(h.view.addAnnotation).toHaveBeenCalledTimes(1);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('does not touch the view or persist the config when the store update fails', async () => {
    h.updateBooknotes.mockReturnValue(undefined);
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    await result.current('note-1', 'new text');

    expect(h.updateBooknotes).toHaveBeenCalledTimes(1);
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it('does not call updateBooknotes at all when the target booknote no longer exists', async () => {
    h.booknotes = [];
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));

    await result.current('note-1', 'new text');

    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
});

describe('note save confirmation (#6123)', () => {
  it('waits for persistence and rejects duplicate attempts while pending', async () => {
    h.updateBooknotes.mockReturnValue({ booknotes: h.booknotes });
    let resolveSave!: () => void;
    h.saveConfig.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));
    const save = result.current('note-1', 'draft');
    expect(await result.current('note-1', 'draft')).toBe(false);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    resolveSave();
    expect(await save).toBe(true);
  });

  it('reports persistence failure and allows retry', async () => {
    h.updateBooknotes.mockReturnValue({ booknotes: h.booknotes });
    h.saveConfig.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));
    expect(await result.current('note-1', 'draft')).toBe(false);
    expect(h.toast).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' }));
    expect(await result.current('note-1', 'draft')).toBe(true);
  });

  it.each([
    'missing',
    'deleted',
    'update rejected',
  ])('reports failure when the note is %s', async (failure) => {
    if (failure === 'missing') h.booknotes = [];
    if (failure === 'deleted') h.booknotes[0]!.deletedAt = 1234;
    h.updateBooknotes.mockReturnValue(undefined);
    const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));
    expect(await result.current('note-1', 'draft')).toBe(false);
    expect(h.saveConfig).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' }));
  });
});

it('rolls back only the failed note and preserves concurrent note changes', async () => {
  const original = makeBooknote();
  const other = makeBooknote({ id: 'other', note: 'before' });
  h.booknotes = [original, other];
  h.updateBooknotes.mockImplementation((_key: string, booknotes: BookNote[]) => {
    h.booknotes = booknotes;
    return { booknotes };
  });
  let rejectSave!: (error: Error) => void;
  h.saveConfig.mockReturnValue(
    new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }),
  );
  const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));
  const save = result.current('note-1', 'failed draft');
  h.booknotes = h.booknotes.map((note) =>
    note.id === 'other' ? { ...note, note: 'concurrent edit' } : note,
  );
  rejectSave(new Error('disk full'));
  expect(await save).toBe(false);
  expect(h.booknotes).toEqual([original, { ...other, note: 'concurrent edit' }]);
  expect(h.view.addAnnotation).not.toHaveBeenCalled();
});

it('does not roll back a newer edit to the same note after persistence fails', async () => {
  h.updateBooknotes.mockImplementation((_key: string, booknotes: BookNote[]) => {
    h.booknotes = booknotes;
    return { booknotes };
  });
  let rejectSave!: (error: Error) => void;
  h.saveConfig.mockReturnValue(
    new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }),
  );
  const { result } = renderHook(() => useSaveBooknoteNoteText('book-1'));
  const save = result.current('note-1', 'failed draft');
  const newer = { ...h.booknotes[0]!, note: 'newer synced note', updatedAt: Date.now() + 1 };
  h.booknotes = [newer];
  rejectSave(new Error('disk full'));
  expect(await save).toBe(false);
  expect(h.booknotes).toEqual([newer]);
});
