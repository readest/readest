import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchOptionsMenu from '@/app/library/components/LibrarySearchOptionsMenu';
import type { LibrarySearchConfig } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

afterEach(cleanup);

const config: LibrarySearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

describe('LibrarySearchOptionsMenu', () => {
  it('emits mode and option changes and closes appropriately', () => {
    const onConfigChange = vi.fn();
    const close = vi.fn();
    const { rerender } = render(
      <LibrarySearchOptionsMenu
        config={config}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );

    fireEvent.click(screen.getByText('Whole Words'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'whole-words', matchWholeWords: true }),
    );
    expect(close).toHaveBeenCalledWith(false);

    close.mockClear();
    fireEvent.click(screen.getByText('Nearby Words'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'nearby-words' }),
    );
    expect(close).not.toHaveBeenCalled();

    rerender(
      <LibrarySearchOptionsMenu
        config={{ ...config, mode: 'nearby-words', nearbyWords: 10 }}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(onConfigChange).toHaveBeenLastCalledWith(expect.objectContaining({ nearbyWords: 20 }));
    expect(close).toHaveBeenCalledWith(false);

    rerender(
      <LibrarySearchOptionsMenu
        config={{ ...config, mode: 'regex' }}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );
    onConfigChange.mockClear();
    fireEvent.click(screen.getByText('Match Diacritics'));
    expect(onConfigChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Match Case'));
    expect(onConfigChange).toHaveBeenLastCalledWith(expect.objectContaining({ matchCase: true }));
  });

  // A device text scale of 1.25 (Android system font size) multiplies every
  // declared font-size, but a hard-coded `w-56` box does not grow with it, so
  // labels wrapped onto a second line and the menu grew past the landscape
  // viewport with no way to scroll.
  it('sizes to its content and stays scrollable so options never wrap', () => {
    const { container } = render(
      <LibrarySearchOptionsMenu config={config} onConfigChange={vi.fn()} />,
    );

    const menu = container.querySelector('.search-options') as HTMLElement;
    expect(menu).toBeTruthy();
    // No fixed width: the box tracks its content so scaled-up text still fits.
    expect(menu.className).not.toMatch(/(^|\s)!?w-\d/);
    // Overlong content scrolls instead of overflowing the screen.
    expect(menu.className).toMatch(/overflow-y-auto/);
    expect(menu.className).toMatch(/max-h-/);

    for (const label of ['Contains', 'Whole Words', 'Regular Expression', 'Match Diacritics']) {
      expect(screen.getByText(label).className).toMatch(/whitespace-nowrap/);
    }
  });
});
