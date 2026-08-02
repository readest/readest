import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BooknoteItem from '@/app/reader/components/sidebar/BooknoteItem';
import { BookNote } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';

// vi.mock factories are hoisted above const initializers, so shared spies MUST
// come from vi.hoisted() — plain top-level consts throw "cannot access before
// initialization" when a factory references them.
const mocks = vi.hoisted(() => {
  const state = { booknotes: [] as { note: string; deletedAt?: number | null }[] };
  return {
    state,
    setNotebookVisible: vi.fn(),
    setNotebookEditAnnotation: vi.fn(),
    addAnnotation: vi.fn(),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(() => ({ booknotes: state.booknotes })),
  };
});

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    setNotebookVisible: mocks.setNotebookVisible,
    setNotebookEditAnnotation: mocks.setNotebookEditAnnotation,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
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

vi.mock('dayjs', () => ({ default: () => ({ fromNow: () => 'now' }) }));

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
    <ul>
      <BooknoteItem bookKey='hash1-primary' item={item} inlineNoteEditing={inlineNoteEditing} />
    </ul>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.booknotes = [];
});

afterEach(() => {
  cleanup();
});

describe('BooknoteItem', () => {
  it('never opens the notebook when a noted item is clicked', () => {
    renderItem(makeItem({ note: 'my note' }));
    fireEvent.click(screen.getByText('highlighted words'));
    expect(mocks.setNotebookVisible).not.toHaveBeenCalled();
  });

  it('shows Add Note on a bare highlight and saves a new note inline', () => {
    const item = makeItem();
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'fresh thought' } });
    fireEvent.click(screen.getByText('Save'));

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

  it('whitespace-only draft saves an empty note', () => {
    const item = makeItem();
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.state.booknotes[0] as BookNote;
    expect(saved.note).toBe('');
    expect(mocks.addAnnotation).not.toHaveBeenCalled();
  });

  it('clearing a note inline keeps the highlight and removes the bubble', () => {
    const item = makeItem({ note: 'old note' });
    mocks.state.booknotes = [item];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    const saved = mocks.state.booknotes[0] as BookNote;
    expect(saved.note).toBe('');
    expect(saved.deletedAt).toBeUndefined();
    expect(mocks.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: `${NOTE_PREFIX}${item.cfi}` }),
      true,
    );
  });

  it('aborts the inline save when the record is gone (deleted by sync)', () => {
    const item = makeItem({ note: 'old note' });
    mocks.state.booknotes = [];
    renderItem(item, true);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'update' } });
    fireEvent.click(screen.getByText('Save'));

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
