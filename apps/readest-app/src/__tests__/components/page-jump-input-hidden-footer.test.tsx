// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageJumpInput from '@/app/reader/components/footerbar/PageJumpInput';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// The footer's page label is the reader's position readout, and on desktop a
// hidden footer only fades out: the label stays in the page and the
// accessibility tree. It has to follow the position while hidden, with nothing
// above it re-rendering (the bars skip that while hidden), so it subscribes to
// the progress store itself.

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/readerStore', () => {
  const state = {
    hoveredBookKey: '',
    getView: () => null,
    getViewSettings: () => ({ progressStyle: 'fraction' }),
  };
  return { useReaderStore: () => state };
});
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: false, bookDoc: {} }) })),
}));

const at = (current: number) =>
  ({ pageinfo: { current, next: current + 1, total: 251 } }) as unknown as BookProgress;

afterEach(() => {
  cleanup();
  clearBookProgress('book1');
});

describe('PageJumpInput in a hidden footer', () => {
  it('appears and follows the position as the book opens and pages turn', () => {
    // mounted with the footer before the book reports a position
    const { queryByRole } = render(<PageJumpInput bookKey='book1' />);
    expect(queryByRole('textbox', { name: 'Go to Page' })).toBeNull();

    act(() => setBookProgress('book1', at(9)));
    const label = () =>
      (queryByRole('textbox', { name: 'Go to Page' }) as HTMLInputElement | null)?.value;
    expect(label()).toBe('10 / 251');

    act(() => setBookProgress('book1', at(10)));
    expect(label()).toBe('11 / 251');
  });
});
