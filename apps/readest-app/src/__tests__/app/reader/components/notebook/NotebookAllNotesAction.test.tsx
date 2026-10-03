import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookHeader from '@/app/reader/components/notebook/Header';
import NotebookEditor from '@/app/reader/components/notebook/NotebookEditor';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';

vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: vi.fn(),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

beforeEach(() => {
  useNotebookDocumentStore.getState().reset();
  useNotebookDocumentStore.getState().hydrate('book', '', null);
});

afterEach(cleanup);

describe('Notebook All notes action', () => {
  it('keeps Annotations navigation out of the header', () => {
    render(<NotebookHeader isPinned={false} handleClose={vi.fn()} handleTogglePin={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Open Annotations' })).toBeNull();
  });

  it('opens all notes from the editor footer', () => {
    const handleOpenAnnotations = vi.fn();
    render(
      <NotebookEditor
        bookKey='book-view'
        handleOpenAnnotations={handleOpenAnnotations}
        excerpts={[]}
        onDeleteExcerpt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
    expect(handleOpenAnnotations).toHaveBeenCalledTimes(1);
  });
});
