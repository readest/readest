// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));

import { useBookConfig, useBookData, useBookDataStore } from '@/store/bookDataStore';
import type { Book, BookConfig, BookNote } from '@/types/book';

const book = { hash: 'h1', title: 'Book' } as Book;

// What every page turn does to the book data (readerStore.setProgress)
const turnPage = (location: string) =>
  act(() =>
    useBookDataStore.setState((state) => ({
      booksData: {
        ...state.booksData,
        h1: {
          ...state.booksData['h1']!,
          config: { ...state.booksData['h1']!.config!, progress: [2, 9], location },
        },
      },
    })),
  );

beforeEach(() => {
  useBookDataStore.setState({
    booksData: {
      h1: {
        id: 'h1',
        book,
        file: null,
        config: { progress: [1, 9], location: 'cfi-1', booknotes: [] } as unknown as BookConfig,
        bookDoc: null,
        isFixedLayout: false,
      },
    },
  });
});
afterEach(cleanup);

describe('useBookData', () => {
  test('re-renders when the book changes, not when its progress does', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useBookData('h1-view');
    });
    expect(result.current?.book).toBe(book);
    const before = renders;
    turnPage('cfi-2');
    expect(renders).toBe(before);
    act(() =>
      useBookDataStore.setState((state) => ({
        booksData: { ...state.booksData, h1: { ...state.booksData['h1']!, isFixedLayout: true } },
      })),
    );
    expect(renders).toBe(before + 1);
    expect(result.current?.isFixedLayout).toBe(true);
  });

  test('is null for a missing book or key', () => {
    expect(renderHook(() => useBookData('nope')).result.current).toBeNull();
    expect(renderHook(() => useBookData(null)).result.current).toBeNull();
  });
});

describe('useBookConfig', () => {
  test('re-renders when the config changes, not when only the progress does', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useBookConfig('h1-view');
    });
    const before = renders;
    turnPage('cfi-2');
    expect(renders).toBe(before);
    const note = { id: 'n1' } as BookNote;
    act(() =>
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          h1: {
            ...state.booksData['h1']!,
            config: { ...state.booksData['h1']!.config!, booknotes: [note] },
          },
        },
      })),
    );
    expect(renders).toBe(before + 1);
    expect(result.current?.booknotes).toEqual([note]);
  });
});
