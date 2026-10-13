import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import '@/styles/globals.css';

const mockPlatform = vi.hoisted(() => ({
  isAndroidApp: true,
  hoveredBookKey: null as string | null,
  showPaginationButtons: false,
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
      getViewSettings: () => ({
        rtl: false,
        showPaginationButtons: mockPlatform.showPaginationButtons,
      }),
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

// Returns whatever actually answers a tap at the given point. Never null in a
// laid-out page, so a `false` from `button.contains()` means the tap really did
// land on something else rather than on nothing at all.
const hitTargetAt = (button: Element, offsetY: number) => {
  const bounds = button.getBoundingClientRect();
  const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + offsetY);
  expect(target).not.toBeNull();
  return target;
};

afterEach(() => {
  cleanup();
  mockPlatform.isAndroidApp = true;
  mockPlatform.hoveredBookKey = null;
  mockPlatform.showPaginationButtons = false;
});

describe('PageNavigationButtons hit areas', () => {
  it('shrinks all four hidden controls so they do not cover selectable text', () => {
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      const bounds = button.getBoundingClientRect();
      expect([bounds.width, bounds.height], label).toEqual([8, 8]);

      expect(button.contains(hitTargetAt(button, -1)), label).toBe(false);
    }
  });

  it('lets taps fall through the hidden controls with the setting off', () => {
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      expect(button.contains(hitTargetAt(button, 4)), label).toBe(false);
    }
  });

  it('lets taps fall through the hidden controls with the setting on', () => {
    mockPlatform.showPaginationButtons = true;
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      expect(button.contains(hitTargetAt(button, 4)), label).toBe(false);
    }
  });

  it('lets taps fall through the hidden controls off Android too', () => {
    mockPlatform.isAndroidApp = false;
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      expect(button.contains(hitTargetAt(button, 4)), label).toBe(false);
    }
  });

  it('takes taps once the controls are actually visible', () => {
    mockPlatform.showPaginationButtons = true;
    mockPlatform.hoveredBookKey = 'book';
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const button = screen.getByRole('button', { name: label });
      expect(button.contains(hitTargetAt(button, 4)), label).toBe(true);
    }
  });

  it('keeps the four visible controls large and distinctly labelled', () => {
    mockPlatform.showPaginationButtons = true;
    mockPlatform.hoveredBookKey = 'book';
    render(<PageNavigationButtons bookKey='book' isDropdownOpen={false} />);

    for (const label of navigationLabels) {
      const bounds = screen.getByRole('button', { name: label }).getBoundingClientRect();
      expect([bounds.width, bounds.height], label).toEqual([80, 80]);
    }
  });
});
