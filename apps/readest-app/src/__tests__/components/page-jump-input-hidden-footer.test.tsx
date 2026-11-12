// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageJumpInput from '@/app/reader/components/footerbar/PageJumpInput';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// A store hook called with a selector, or without one for the whole state.
const { storeHook } = vi.hoisted(() => ({
  storeHook:
    <T extends object>(state: () => T) =>
    (select?: (s: T) => unknown) =>
      select ? select(state()) : state(),
}));

// The footer's page label is the reader's position readout, and on desktop a
// hidden footer only fades out: the label stays in the page and the
// accessibility tree. It has to follow the position while hidden, with nothing
// above it re-rendering (the bars skip that while hidden), so it subscribes to
// the progress store itself.

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/readerStore', () => {
  const state = {
    viewStates: {},
    hoveredBookKey: '',
    getView: () => null,
    getViewSettings: () => ({ progressStyle: 'fraction' }),
  };
  return { useReaderStore: storeHook(() => state) };
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

  it('follows a page turn in the commit that writes it', () => {
    // A second commit per turn (the label's last valid page saved from an
    // effect) walks the whole tree from the root again: on the Kindle, tens of
    // milliseconds a turn.
    act(() => setBookProgress('book1', at(9)));
    const onRender = vi.fn();
    render(
      <Profiler id='label' onRender={onRender}>
        <PageJumpInput bookKey='book1' />
      </Profiler>,
    );
    onRender.mockClear();

    act(() => setBookProgress('book1', at(10)));

    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('keeps the last valid page while a relocation reports none (#6646)', () => {
    act(() => setBookProgress('book1', at(9)));
    const { queryByRole } = render(<PageJumpInput bookKey='book1' />);

    act(() => setBookProgress('book1', at(-1)));

    expect((queryByRole('textbox', { name: 'Go to Page' }) as HTMLInputElement).value).toBe(
      '10 / 251',
    );
  });
});
