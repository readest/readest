// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PageJumpInput from '@/app/reader/components/footerbar/PageJumpInput';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import { clearChapterScreens, recordChapterScreens } from '@/utils/chapterScreens';
import type { BookProgress } from '@/types/book';

// With Stable Page Numbers off the footer counts this device's screens. The
// footer bar's label, its slider preview and its jump field have to count the
// same pages, or the reader sees "4 / 8" in the footer and "5 / 9" above it
// (#7445).

const goToFraction = vi.hoisted(() => vi.fn());
const goTo = vi.hoisted(() => vi.fn());
const viewSettings = vi.hoisted(() => ({
  progressStyle: 'fraction',
  stablePageNumbers: false as boolean,
  scrolled: false,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/readerStore', () => {
  const view = {
    renderer: { page: 1 },
    getSectionFractions: () => [0, 0.25, 0.5, 1],
    goToFraction,
    goTo,
  };
  const state = {
    hoveredBookKey: 'book1',
    getView: () => view,
    getViewSettings: () => viewSettings,
  };
  return { useReaderStore: () => state };
});
// Three chapters of 3000, 3000 and 6000 bytes.
const bookDoc = vi.hoisted(() => ({ sections: [{ size: 3000 }, { size: 3000 }, { size: 6000 }] }));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: false, bookDoc }) })),
}));

// Second screen of chapter 1. The byte grid calls it 5 / 9.
const progress = {
  section: { current: 1, total: 3 },
  pageinfo: { current: 4, next: 5, total: 9 },
  fraction: 0.4,
} as unknown as BookProgress;

const label = (container: HTMLElement) =>
  (container.querySelector('input[aria-label="Go to Page"]') as HTMLInputElement).value;

beforeEach(() => {
  viewSettings.stablePageNumbers = false;
  // Measured: 2 + 2 + 4 screens, so the second screen of chapter 1 is page 4.
  recordChapterScreens('book1', 0, 2);
  recordChapterScreens('book1', 1, 2);
  recordChapterScreens('book1', 2, 4);
  act(() => setBookProgress('book1', progress));
});

afterEach(() => {
  cleanup();
  clearBookProgress('book1');
  clearChapterScreens('book1');
  goToFraction.mockClear();
  goTo.mockClear();
});

describe('PageJumpInput with Stable Page Numbers off', () => {
  it('labels the screen page the footer shows', () => {
    const { container } = render(<PageJumpInput bookKey='book1' />);
    expect(label(container)).toBe('4 / 8');
  });

  it('previews the screen page under the dragged slider', () => {
    const { container } = render(<PageJumpInput bookKey='book1' previewFraction={0.75} />);
    expect(label(container)).toBe('6 / 8');
  });

  it('jumps to the screen page typed, at the fraction that lands on it', () => {
    const { container } = render(<PageJumpInput bookKey='book1' />);
    const input = container.querySelector('input[aria-label="Go to Page"]') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Page 7 is the third of chapter 2's four screens: 2 / 3 into it.
    expect(goToFraction).not.toHaveBeenCalled();
    expect(goTo).toHaveBeenCalledOnce();
    expect(goTo.mock.calls[0]![0].fraction).toBeCloseTo(0.5 + (2 / 3) * 0.5);
    expect(goTo.mock.calls[0]![1]).toEqual({ focus: true });
  });

  it('keeps the byte-grid pair with Stable Page Numbers on', () => {
    viewSettings.stablePageNumbers = true;
    const { container } = render(<PageJumpInput bookKey='book1' />);
    expect(label(container)).toBe('5 / 9');
  });
});
