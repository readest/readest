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
});
