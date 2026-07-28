import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibrarySearchMenu from '@/app/library/components/LibrarySearchMenu';
import type { BookSearchConfig } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

afterEach(cleanup);

const config: BookSearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
};

describe('LibrarySearchMenu', () => {
  it('switches targets and exposes all content modes', () => {
    const onTargetChange = vi.fn();
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
    expect(contents.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(contents);
    expect(onTargetChange).toHaveBeenCalledWith('contents');
    expect(close).toHaveBeenCalledWith(false);

    rerender(
      <LibrarySearchMenu
        target='contents'
        config={config}
        onTargetChange={onTargetChange}
        onConfigChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('menuitemradio', { name: 'Fuzzy' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Regular Expression' })).toBeTruthy();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match Case' })).toBeTruthy();
  });

  it('updates modes and keeps the compatibility whole-word flag', () => {
    const onConfigChange = vi.fn();
    render(
      <LibrarySearchMenu
        target='contents'
        config={config}
        onTargetChange={vi.fn()}
        onConfigChange={onConfigChange}
      />,
    );

    fireEvent.click(screen.getByText('Whole Words'));
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'whole-words', matchWholeWords: true }),
    );
  });

  it('keeps nearby mode open until a distance is selected', () => {
    const close = vi.fn();
    const onConfigChange = vi.fn();
    const { rerender } = render(
      <LibrarySearchMenu
        target='contents'
        config={config}
        onTargetChange={vi.fn()}
        onConfigChange={onConfigChange}
        setIsDropdownOpen={close}
      />,
    );

    fireEvent.click(screen.getByText('Nearby Words'));
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'nearby-words' }));
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
