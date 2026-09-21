import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BooknoteItem from '@/app/reader/components/sidebar/BooknoteItem';
import { BooknoteTimeProvider } from '@/app/reader/components/sidebar/BooknoteTime';
import { BookNote } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { NOTE_PREFIX } from '@/types/view';

// vi.mock factories are hoisted above const initializers, so shared spies MUST
// come from vi.hoisted() — plain top-level consts throw "cannot access before
// initialization" when a factory references them.
const mocks = vi.hoisted(() => {
  const state = { booknotes: [] as { note: string; deletedAt?: number | null }[] };
  return {
    state,
    setNotebookVisible: vi.fn(),
    setNotebookActiveTab: vi.fn(),
    setNotebookEditAnnotation: vi.fn(),
    toast: vi.fn(),
    addAnnotation: vi.fn(),
    saveConfig: vi.fn(),
    // Mirrors the real store: `updateBooknotes` writes back whatever array
    // it's called with (production code now returns a new array from
    // `updateBooknoteNoteText` instead of mutating the existing one).
    updateBooknotes: vi.fn((_key: string, booknotes: typeof state.booknotes) => {
      state.booknotes = booknotes;
      return { booknotes: state.booknotes };
    }),
  };
});

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    setNotebookVisible: mocks.setNotebookVisible,
    setNotebookActiveTab: mocks.setNotebookActiveTab,
    setNotebookEditAnnotation: mocks.setNotebookEditAnnotation,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { customHighlightColors: {} } },
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => undefined,
    getView: () => null,
    getViewsById: () => [{ addAnnotation: mocks.addAnnotation }],
    getViewSettings: () => undefined,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: mocks.state.booknotes }),
    saveConfig: mocks.saveConfig,
    updateBooknotes: mocks.updateBooknotes,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

dayjs.extend(relativeTime);

const makeItem = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  text: 'highlighted words',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const renderItem = (item: BookNote, inlineNoteEditing?: boolean) =>
  render(
    <BooknoteTimeProvider>
      <ul>
        <BooknoteItem bookKey='hash1-primary' item={item} inlineNoteEditing={inlineNoteEditing} />
      </ul>
    </BooknoteTimeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.booknotes = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BooknoteItem', () => {
  it('refreshes the relative time every minute without remounting the item', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
    renderItem(makeItem({ type: 'bookmark', createdAt: Date.now() }));

    expect(screen.getByText('a few seconds ago')).toBeTruthy();
    act(() => vi.advanceTimersByTime(59_999));
    expect(screen.getByText('a few seconds ago')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('a minute ago')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('2 minutes ago')).toBeTruthy();
  });

  it('shares one timer across items, cleans it up, and recalculates on reopening', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
    const item = makeItem({ type: 'bookmark', createdAt: Date.now() });
    const secondItem = makeItem({ id: 'note-2', createdAt: Date.now() });
    const { unmount } = render(
      <BooknoteTimeProvider>
        <ul>
          <BooknoteItem bookKey='hash1-primary' item={item} />
          <BooknoteItem bookKey='hash1-primary' item={secondItem} />
        </ul>
      </BooknoteTimeProvider>,
    );

    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getAllByText('a minute ago')).toHaveLength(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    act(() => vi.advanceTimersByTime(4 * 60_000));
    renderItem(item);
    expect(screen.getByText('5 minutes ago')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('never opens the notebook when a noted item is clicked', () => {
    renderItem(makeItem({ note: 'my note' }));
    fireEvent.click(screen.getByText('highlighted words'));
    expect(mocks.setNotebookVisible).not.toHaveBeenCalled();
  });

  it('shows Add Note on a bare highlight and saves a new note inline', async () => {
    const item = makeItem();
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'fresh thought' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.state.booknotes[0] as BookNote;
    expect(saved.note).toBe('fresh thought');
    expect(saved.updatedAt).toBeGreaterThan(1000);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'fresh thought', value: `${NOTE_PREFIX}${item.cfi}` }),
      false,
    );
  });

  it('whitespace-only draft saves an empty note', async () => {
    const item = makeItem();
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.state.booknotes[0] as BookNote;
    expect(saved.note).toBe('');
    expect(mocks.addAnnotation).not.toHaveBeenCalled();
  });

  it('clearing a note inline keeps the highlight and removes the bubble', async () => {
    const item = makeItem({ note: 'old note' });
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    const saved = mocks.state.booknotes[0] as BookNote;
    expect(saved.note).toBe('');
    expect(saved.deletedAt).toBeUndefined();
    expect(mocks.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: `${NOTE_PREFIX}${item.cfi}` }),
      true,
    );
  });

  it('aborts the inline save when the record is gone (deleted by sync)', async () => {
    const item = makeItem({ note: 'old note' });
    mocks.state.booknotes = [];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'update' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('update');
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('routes Edit to the notebook editor without inlineNoteEditing', () => {
    const item = makeItem({ note: 'my note' });
    renderItem(item);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(mocks.setNotebookEditAnnotation).toHaveBeenCalledWith(item);
    expect(mocks.setNotebookVisible).toHaveBeenCalledWith(true);
  });

  it('hides the edit affordance for bare highlights without inlineNoteEditing', () => {
    renderItem(makeItem());
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Note' })).toBeNull();
  });
});

it('keeps the inline draft through a failed save and closes only after retry succeeds (#6123)', async () => {
  const item = makeItem({ note: 'old note' });
  mocks.state.booknotes = [item];
  renderItem(item, true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft to keep' } });
  let rejectSave!: (error: Error) => void;
  mocks.saveConfig.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }),
  );
  const toast = vi.spyOn(eventDispatcher, 'dispatch');
  fireEvent.click(screen.getByText('Save'));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft to keep');
  fireEvent.click(screen.getByText('Save'));
  expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  await act(async () => {
    rejectSave(new Error('disk full'));
  });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft to keep');
  expect(toast).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' }));
  expect(mocks.state.booknotes[0]?.note).toBe('old note');
  expect(mocks.addAnnotation).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText('Save'));
  });
  expect(screen.queryByRole('textbox')).toBeNull();
  toast.mockRestore();
});
