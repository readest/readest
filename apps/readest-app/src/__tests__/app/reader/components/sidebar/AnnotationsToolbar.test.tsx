import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnnotationsToolbar from '@/app/reader/components/sidebar/AnnotationsToolbar';
import { HighlightColor, HighlightStyle } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/components/Dropdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Menu', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div role='menu'>{children}</div>,
}));

vi.mock('@/components/MenuItem', () => ({
  __esModule: true,
  default: ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        customHighlightColors: {},
        defaultHighlightLabels: {},
        userHighlightColors: [],
      },
    },
  }),
}));

const defaultProps = {
  bookKey: 'hash1-primary',
  filterKind: 'all' as const,
  searchInput: '',
  canClear: true,
  colors: [] as HighlightColor[],
  styles: [] as HighlightStyle[],
  excludedColors: [] as HighlightColor[],
  excludedStyles: [] as HighlightStyle[],
  onFilterKindChange: vi.fn(),
  onSearchInputChange: vi.fn(),
  onToggleColor: vi.fn(),
  onToggleStyle: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AnnotationsToolbar', () => {
  it('reports chip selection', () => {
    render(<AnnotationsToolbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlights' }));
    expect(defaultProps.onFilterKindChange).toHaveBeenCalledWith('highlights');
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(defaultProps.onFilterKindChange).toHaveBeenCalledWith('notes');
  });

  it('marks the active chip with aria-pressed', () => {
    render(<AnnotationsToolbar {...defaultProps} filterKind='notes' />);
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports search input changes and clears them', () => {
    const { rerender } = render(<AnnotationsToolbar {...defaultProps} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rabbit' } });
    expect(defaultProps.onSearchInputChange).toHaveBeenCalledWith('rabbit');

    rerender(<AnnotationsToolbar {...defaultProps} searchInput='rabbit' />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(defaultProps.onSearchInputChange).toHaveBeenCalledWith('');
  });

  it('dispatches the annotation actions with the bookKey', () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    render(<AnnotationsToolbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export Annotations' }));
    expect(dispatchSpy).toHaveBeenCalledWith('export-annotations', { bookKey: 'hash1-primary' });
    fireEvent.click(screen.getByRole('button', { name: 'Import Annotations' }));
    expect(dispatchSpy).toHaveBeenCalledWith('import-annotations', { bookKey: 'hash1-primary' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Annotations' }));
    expect(dispatchSpy).toHaveBeenCalledWith('clear-annotations', { bookKey: 'hash1-primary' });
  });

  it('disables Clear Annotations when there is nothing to clear', () => {
    render(<AnnotationsToolbar {...defaultProps} canClear={false} />);
    const clearButton = screen.getByRole('button', { name: 'Clear Annotations' });
    expect((clearButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides facet toggles for dimensions with fewer than two distinct values', () => {
    render(<AnnotationsToolbar {...defaultProps} colors={['yellow']} styles={['highlight']} />);
    expect(screen.queryByRole('button', { name: 'yellow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'highlight' })).toBeNull();
  });

  it('renders color dots and reports exclusion toggles', () => {
    render(
      <AnnotationsToolbar {...defaultProps} colors={['yellow', 'red']} excludedColors={['red']} />,
    );
    const yellow = screen.getByRole('button', { name: 'yellow' });
    const red = screen.getByRole('button', { name: 'red' });
    expect(yellow.getAttribute('aria-pressed')).toBe('true');
    expect(red.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(yellow);
    expect(defaultProps.onToggleColor).toHaveBeenCalledWith('yellow');
  });

  it('renders style chips and reports exclusion toggles', () => {
    render(
      <AnnotationsToolbar
        {...defaultProps}
        styles={['highlight', 'underline']}
        excludedStyles={['underline']}
      />,
    );
    expect(screen.getByRole('button', { name: 'highlight' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const underline = screen.getByRole('button', { name: 'underline' });
    expect(underline.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(underline);
    expect(defaultProps.onToggleStyle).toHaveBeenCalledWith('underline');
  });
});
