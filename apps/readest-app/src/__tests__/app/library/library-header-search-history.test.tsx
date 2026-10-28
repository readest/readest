import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LibraryHeader from '@/app/library/components/LibraryHeader';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ currentBookshelf: [] }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
    systemUIVisible: false,
    statusBarHeight: 0,
    isIPhoneDuo: false,
  }),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));

afterEach(cleanup);

const baseProps = {
  isSelectMode: false,
  isSelectAll: false,
  onPullLibrary: vi.fn(),
  onImportBooksFromFiles: vi.fn(),
  onOpenCatalogManager: vi.fn(),
  onOpenFeeds: vi.fn(),
  onToggleSelectMode: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  searchTarget: 'books' as const,
  searchConfig: {
    scope: 'book' as const,
    mode: 'contains' as const,
    matchCase: false,
    matchDiacritics: false,
  },
  onSearchConfigChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  onSearchTargetChange: vi.fn(),
};

describe('LibraryHeader search history support (#7126)', () => {
  it('calls onSearchSubmit when Enter is pressed with a non-empty query', () => {
    const onSearchSubmit = vi.fn();
    render(<LibraryHeader {...baseProps} searchQuery='Asimov' onSearchSubmit={onSearchSubmit} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearchSubmit).toHaveBeenCalledTimes(1);
    expect(onSearchSubmit).toHaveBeenCalledWith('Asimov');
  });

  it('does not call onSearchSubmit when Enter is pressed with an empty query', () => {
    const onSearchSubmit = vi.fn();
    render(<LibraryHeader {...baseProps} searchQuery='   ' onSearchSubmit={onSearchSubmit} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearchSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSearchSubmit when Enter is pressed during IME composition', () => {
    const onSearchSubmit = vi.fn();
    render(<LibraryHeader {...baseProps} searchQuery='Dune' onSearchSubmit={onSearchSubmit} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onSearchSubmit).not.toHaveBeenCalled();
  });
});
