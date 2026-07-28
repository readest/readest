import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchMenu from '@/app/library/components/LibrarySearchMenu';
import type { LibrarySearchConfig } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

afterEach(cleanup);

const config: LibrarySearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

describe('LibrarySearchMenu', () => {
  it('switches targets and emits the selected content-mode configuration', () => {
    const onTargetChange = vi.fn();
    const onConfigChange = vi.fn();
    const close = vi.fn();
    const { rerender } = render(
      <LibrarySearchMenu
        target='books'
        config={config}
        onTargetChange={onTargetChange}
        onConfigChange={vi.fn()}
        setIsDropdownOpen={close}
      />,
    );

    const contents = screen.getByRole('menuitemradio', { name: 'Contents' });
    fireEvent.click(contents);
    expect(onTargetChange).toHaveBeenCalledWith('contents');

    rerender(
      <LibrarySearchMenu
        target='contents'
        config={config}
        onTargetChange={onTargetChange}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );

    fireEvent.click(screen.getByText('Fuzzy'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'fuzzy', matchWholeWords: false }),
    );
    fireEvent.click(screen.getByText('Whole Words'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'whole-words', matchWholeWords: true }),
    );

    close.mockClear();
    fireEvent.click(screen.getByText('Nearby Words'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'nearby-words' }),
    );
    expect(close).not.toHaveBeenCalled();

    rerender(
      <LibrarySearchMenu
        target='contents'
        config={{ ...config, mode: 'nearby-words', nearbyWords: 10 }}
        onTargetChange={vi.fn()}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'nearby-words', nearbyWords: 20 }),
    );
    expect(close).toHaveBeenCalledWith(false);
  });
});
