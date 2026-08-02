import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnnotationsToolbar from '@/app/reader/components/sidebar/AnnotationsToolbar';
import { HighlightColor, HighlightStyle } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/components/Dropdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactElement<{ menuClassName?: string }> }) => (
    <div>{React.cloneElement(children, { menuClassName: 'injected-menu-class' })}</div>
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
  filterKind: 'all' as const,
  searchInput: '',
  isSearchVisible: false,
  colors: [] as HighlightColor[],
  styles: [] as HighlightStyle[],
  excludedColors: [] as HighlightColor[],
  excludedStyles: [] as HighlightStyle[],
  onFilterKindChange: vi.fn(),
  onSearchInputChange: vi.fn(),
  onCloseSearch: vi.fn(),
  onToggleColor: vi.fn(),
  onToggleStyle: vi.fn(),
  onResetFilters: vi.fn(),
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

  it('renders the search input only while isSearchVisible', () => {
    const { rerender } = render(<AnnotationsToolbar {...defaultProps} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<AnnotationsToolbar {...defaultProps} isSearchVisible />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rabbit' } });
    expect(defaultProps.onSearchInputChange).toHaveBeenCalledWith('rabbit');
  });

  it('the clear button and Escape request closing the search', () => {
    render(<AnnotationsToolbar {...defaultProps} isSearchVisible />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(defaultProps.onCloseSearch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(defaultProps.onCloseSearch).toHaveBeenCalledTimes(2);
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

  it('renders style toggles and reports exclusion toggles', () => {
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

  it('Reset calls onResetFilters and is disabled when nothing is active', () => {
    const { rerender } = render(<AnnotationsToolbar {...defaultProps} filterKind='notes' />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(defaultProps.onResetFilters).toHaveBeenCalledTimes(1);

    rerender(<AnnotationsToolbar {...defaultProps} />);
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('merges the Dropdown-injected menuClassName into the filter panel', () => {
    const { container } = render(<AnnotationsToolbar {...defaultProps} />);
    const filterPanel = container.querySelector('.annotations-filter-panel');
    expect(filterPanel?.className).toContain('injected-menu-class');
  });
});
