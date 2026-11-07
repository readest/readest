import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LibraryHeader from '@/app/library/components/LibraryHeader';
import {
  addLibrarySearchHistory,
  loadLibrarySearchHistory,
} from '@/app/library/utils/searchHistory';
import type { LibrarySearchTarget } from '@/types/book';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, value),
      key,
    ),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ currentBookshelf: [] }) }));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));

const apply = vi.fn();
const noop = () => {};
const Header = ({ target = 'books' }: { target?: LibrarySearchTarget }) => {
  const [query, setQuery] = useState('');
  const [searchTarget, setSearchTarget] = useState(target);
  return (
    <LibraryHeader
      isSelectMode={false}
      isSelectAll={false}
      onPullLibrary={noop}
      onImportBooksFromFiles={noop}
      onOpenCatalogManager={noop}
      onOpenFeeds={noop}
      onToggleSelectMode={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      searchQuery={query}
      searchTarget={searchTarget}
      searchConfig={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
      onSearchConfigChange={noop}
      onSearchQueryChange={setQuery}
      onSearchQueryApply={(term) => {
        apply(term);
        setQuery(term);
      }}
      onSearchTargetChange={setSearchTarget}
    />
  );
};

beforeEach(() => {
  localStorage.clear();
  apply.mockReset();
});
afterEach(cleanup);

describe('library search history dropdown', () => {
  it('opens on focus, filters while typing, and immediately applies a selected search', () => {
    addLibrarySearchHistory('Dune', 'books');
    addLibrarySearchHistory('Earthsea', 'books');
    render(<Header />);
    const input = screen.getByRole('textbox');
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByRole('button', { name: 'Dune' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Earthsea' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Du' } });
    expect(screen.queryByRole('button', { name: 'Earthsea' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dune' }));
    expect(apply).toHaveBeenCalledWith('Dune');
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
    expect((input as HTMLInputElement).value).toBe('Dune');
  });

  it('removes one item, persists it, and clears all remaining history', () => {
    addLibrarySearchHistory('Dune', 'books');
    addLibrarySearchHistory('Earthsea', 'books');
    render(<Header />);
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dune from search history' }));
    expect(loadLibrarySearchHistory('books')).toEqual(['Earthsea']);
    expect(screen.queryByRole('button', { name: 'Dune' })).toBeNull();
    expect(apply).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search history' }));
    expect(loadLibrarySearchHistory('books')).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
  });

  it.each([
    'remove',
    'clear',
  ] as const)('applies pending book input before history %s', (action) => {
    addLibrarySearchHistory('Dune', 'books');
    apply.mockImplementationOnce((term: string) => addLibrarySearchHistory(term, 'books'));
    render(<Header />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: action === 'remove' ? 'Remove Dune from search history' : 'Clear search history',
      }),
    );
    expect(apply).toHaveBeenCalledWith('Dune');
    expect(loadLibrarySearchHistory('books')).toEqual([]);
  });

  it('saves an explicitly submitted book query and refreshes history recency', () => {
    render(<Header />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Dune' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(loadLibrarySearchHistory('books')).toEqual(['Dune']);
    addLibrarySearchHistory('Earthsea', 'books');
    fireEvent.click(input);
    fireEvent.click(screen.getByRole('button', { name: 'Dune' }));
    expect(loadLibrarySearchHistory('books')).toEqual(['Dune', 'Earthsea']);
  });

  it('dismisses on Escape and outside presses and supports keyboard selection', () => {
    addLibrarySearchHistory('Dune', 'books');
    render(<Header />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
    fireEvent.click(input);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dune' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('region', { name: 'Search history' })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(apply).toHaveBeenCalledWith('');
  });

  it('keeps book and full-text histories separate and reads the legacy full-text history', () => {
    addLibrarySearchHistory('Dune', 'books');
    addLibrarySearchHistory('spice');
    render(<Header target='text' />);
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: 'spice' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dune' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search history' }));
    expect(loadLibrarySearchHistory()).toEqual([]);
    expect(loadLibrarySearchHistory('books')).toEqual(['Dune']);
  });
});
