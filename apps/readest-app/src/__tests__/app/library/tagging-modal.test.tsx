import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

const setLibrary = vi.fn();
const saveLibraryBooks = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => ({ current: null }) }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { saveLibraryBooks } }) }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ setLibrary }) }));

import TaggingModal from '@/app/library/components/TaggingModal';

const book = (hash: string, tags?: string[]): Book => ({
  hash,
  title: hash,
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  tags,
});

let books: Book[];
const onCancel = vi.fn();
const onConfirm = vi.fn();

beforeEach(() => {
  books = [book('a', ['Classic', 'Sci-Fi']), book('b', ['Classic']), book('c', ['Horror'])];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderModal = () =>
  render(
    <TaggingModal
      libraryBooks={books}
      bookHashes={['a', 'b']}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );

const tag = (name: string) => screen.getByRole('checkbox', { name });
const confirm = () => screen.getByText('Confirm').closest('button') as HTMLButtonElement;
const savedBooks = () => setLibrary.mock.calls[0]![0] as Book[];

describe('TaggingModal', () => {
  it('lists every tag in the library with its state for the selected books', () => {
    renderModal();
    expect(screen.getAllByRole('checkbox').map((el) => el.getAttribute('aria-label'))).toEqual([
      'Classic',
      'Horror',
      'Sci-Fi',
    ]);
    expect(tag('Classic').getAttribute('aria-checked')).toBe('true');
    expect(tag('Sci-Fi').getAttribute('aria-checked')).toBe('mixed');
    expect(tag('Horror').getAttribute('aria-checked')).toBe('false');
  });

  it('changes the tags of the selected books on confirm', () => {
    renderModal();
    fireEvent.click(tag('Classic'));
    fireEvent.click(tag('Horror'));
    expect(tag('Classic').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(confirm());

    expect(savedBooks().map((b) => b.tags)).toEqual([['Sci-Fi', 'Horror'], ['Horror'], ['Horror']]);
    expect(saveLibraryBooks).toHaveBeenCalledWith(savedBooks());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('creates a new tag checked for the selection', () => {
    renderModal();
    fireEvent.click(screen.getByText('Create New Tag'));
    fireEvent.change(screen.getByPlaceholderText('Tag name'), { target: { value: ' Favorites ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(tag('Favorites').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(confirm());
    expect(savedBooks().map((b) => b.tags)).toEqual([
      ['Classic', 'Sci-Fi', 'Favorites'],
      ['Classic', 'Favorites'],
      ['Horror'],
    ]);
  });

  it('offers no way to delete a tag from the whole library', () => {
    books.push(book('d', ['Classic']));
    renderModal();
    expect(screen.queryByLabelText('Delete Tag')).toBeNull();
    fireEvent.click(tag('Classic'));
    fireEvent.click(confirm());
    // Unchecking only reaches the selection; unselected books keep the tag.
    expect(savedBooks()[3]).toBe(books[3]);
    expect(savedBooks()[3]!.tags).toEqual(['Classic']);
  });

  it('removes all tags from the selected books', () => {
    renderModal();
    fireEvent.click(screen.getByText('Remove All Tags'));
    fireEvent.click(confirm());
    expect(savedBooks().map((b) => b.tags)).toEqual([[], [], ['Horror']]);
  });

  it('keeps confirm disabled until something changes, and cancel saves nothing', () => {
    renderModal();
    expect(confirm().disabled).toBe(true);
    fireEvent.click(tag('Horror'));
    expect(confirm().disabled).toBe(false);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(setLibrary).not.toHaveBeenCalled();
  });
});
