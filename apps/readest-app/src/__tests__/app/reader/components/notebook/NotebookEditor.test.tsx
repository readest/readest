import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotebookEditor from '@/app/reader/components/notebook/NotebookEditor';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';

const flushNotebookDocument = vi.fn(async (_bookKey: string) => 'saved');
const handleOpenAnnotations = vi.fn();
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: (bookKey: string) => flushNotebookDocument(bookKey),
}));

describe('NotebookEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', '', null);
  });

  afterEach(cleanup);

  it('renders a selectable, spellchecked raw Markdown editor as the blank state', () => {
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    expect(editor.getAttribute('placeholder')).toBe('Start writing about this book…');
    expect(editor.getAttribute('dir')).toBe('auto');
    expect(editor.getAttribute('spellcheck')).toBe('true');
    expect(editor.classList.contains('select-text')).toBe(true);
    expect(screen.queryByText('No Notes')).toBeNull();
  });

  it('updates the isolated document session while typing', () => {
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Notebook' }), {
      target: { value: '# Reading notes' },
    });

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: '# Reading notes',
      status: 'dirty',
      revision: 1,
    });
  });

  it('waits until compositionend before validating IME input', () => {
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);
    const editor = screen.getByRole('textbox', { name: 'Notebook' });

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '你' } });
    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('');

    fireEvent.compositionEnd(editor, { currentTarget: { value: '你' } });
    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('你');
  });

  it('flushes on the save shortcut and blur', () => {
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);
    const editor = screen.getByRole('textbox', { name: 'Notebook' });

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    fireEvent.blur(editor);

    expect(flushNotebookDocument).toHaveBeenCalledTimes(2);
    expect(flushNotebookDocument).toHaveBeenCalledWith('book-view');
  });

  it('shows local durability status in a polite live region', () => {
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);

    act(() => {
      useNotebookDocumentStore.getState().mutate('book', 'draft');
      useNotebookDocumentStore.getState().markSaving('book', 1);
    });
    expect(screen.getByRole('status').textContent).toBe('Saving…');

    act(() => {
      useNotebookDocumentStore.getState().markSaved('book', 1, 'draft', 100);
    });
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('offers both recovery choices without overwriting either copy', () => {
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', 'latest saved', 200, 'local draft');
    render(<NotebookEditor bookKey='book-view' handleOpenAnnotations={handleOpenAnnotations} />);

    expect((screen.getByRole('textbox', { name: 'Notebook' }) as HTMLTextAreaElement).value).toBe(
      'latest saved',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recover draft' }));

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'local draft',
      status: 'dirty',
    });
  });
});
