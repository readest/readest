import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import '@/styles/globals.css';

const mockPlatform = vi.hoisted(() => ({
  isAndroidApp: true,
  hoveredBookKey: null as string | null,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: mockPlatform.isAndroidApp } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (
    selector: (state: {
      getView: () => null;
      getViewSettings: () => { rtl: boolean; showPaginationButtons: boolean };
      hoveredBookKey: string | null;
    }) => unknown,
  ) =>
    selector({
      getView: () => null,
      getViewSettings: () => ({ rtl: false, showPaginationButtons: true }),
      hoveredBookKey: mockPlatform.hoveredBookKey,
    }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: { getBookData: () => null }) => unknown) =>
    selector({ getBookData: () => null }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => undefined,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/app/reader/hooks/usePagination', () => ({
  viewPagination: vi.fn(),
}));

const { default: PageNavigationButtons } = await import(
  '@/app/reader/components/PageNavigationButtons'
);

const navigationLabels = ['Previous Section', 'Previous Page', 'Next Page', 'Next Section'];

afterEach(() => {
  cleanup();
  mockPlatform.isAndroidApp = true;
  mockPlatform.hoveredBookKey = null;
});

describe('PageNavigationButtons Android hit areas', () => {
  it('shrinks all four hidden controls so they do not cover selectable text', () => {
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      const bounds = button.getBoundingClientRect();
      expect([bounds.width, bounds.height], label).toEqual([16, 16]);

      const hitTarget = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top - 1);
      expect(button.contains(hitTarget), label).toBe(false);
    }
  });

  it('keeps the four visible controls large and distinctly labelled', () => {
    mockPlatform.hoveredBookKey = 'book';
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const bounds = screen.getByRole('button', { name: label }).getBoundingClientRect();
      expect([bounds.width, bounds.height], label).toEqual([80, 80]);
    }
  });
});
