import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BookshelfExclusivitySection from '@/app/library/components/BookshelfExclusivitySection';
import BookshelfGroupingSection from '@/app/library/components/BookshelfGroupingSection';
import BookshelfSortingSection from '@/app/library/components/BookshelfSortingSection';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { LibraryGroupByType } from '@/types/settings';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const shelf = { ...createBookshelf('Shelf'), useGlobalGrouping: false, useGlobalSort: false };

describe('BookshelfGroupingSection', () => {
  afterEach(cleanup);

  it('offers "Use global grouping" only when a global value is passed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BookshelfGroupingSection shelf={shelf} onChange={onChange} />);
    expect(screen.queryByLabelText('Use global grouping')).toBeNull();

    rerender(
      <BookshelfGroupingSection
        shelf={shelf}
        onChange={onChange}
        globalGroupBy={LibraryGroupByType.Series}
      />,
    );
    fireEvent.click(screen.getByLabelText('Use global grouping'));
    expect(onChange).toHaveBeenCalledWith({ useGlobalGrouping: true });
  });

  it("edits the shelf's own axis when it has no global to inherit", () => {
    const onChange = vi.fn();
    render(<BookshelfGroupingSection shelf={shelf} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'series' } });
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'series' });
  });
});

describe('BookshelfSortingSection', () => {
  afterEach(cleanup);

  it('offers "Use global sorting" only when a global sort is passed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BookshelfSortingSection shelf={shelf} onChange={onChange} />);
    expect(screen.queryByLabelText('Use global sorting')).toBeNull();

    rerender(<BookshelfSortingSection shelf={shelf} onChange={onChange} globalSort={shelf.sort} />);
    expect(screen.getByLabelText('Use global sorting')).toBeTruthy();
  });

  it("patches the shelf's own sort", () => {
    const onChange = vi.fn();
    render(<BookshelfSortingSection shelf={shelf} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Ascending'));
    expect(onChange).toHaveBeenCalledWith({ sort: { ...shelf.sort, ascending: true } });
  });
});

describe('BookshelfExclusivitySection', () => {
  afterEach(cleanup);

  const statusFilter = {
    type: 'group' as const,
    match: 'all' as const,
    children: [
      {
        type: 'rule' as const,
        field: 'status',
        kind: 'text' as const,
        operator: 'equals' as const,
        value: 'reading',
      },
    ],
  };
  const renderSection = (over: Partial<typeof shelf>, onChange = vi.fn()) => {
    render(
      <BookshelfExclusivitySection
        shelf={{ ...shelf, ...over }}
        onChange={onChange}
        description='Tie rule'
        includeLabel='Include others'
      />,
    );
    return onChange;
  };

  it('shows the given texts, and Exclusive needs a complete filter', () => {
    renderSection({});
    expect(screen.getByText('Tie rule')).toBeTruthy();
    expect((screen.getByLabelText(/^Exclusive/) as HTMLInputElement).disabled).toBe(true);
  });

  it('turning Exclusive on forces include off, and off restores the earlier include choice', () => {
    const onChange = renderSection({ filters: statusFilter, includeExclusiveBooks: true });
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    expect(onChange).toHaveBeenCalledWith({ exclusive: true, includeExclusiveBooks: false });
    cleanup();

    const off = renderSection({ filters: statusFilter, exclusive: true });
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    expect(off).toHaveBeenCalledWith({ exclusive: false, includeExclusiveBooks: false });
    expect((screen.getByLabelText('Include others') as HTMLInputElement).disabled).toBe(true);
  });
});
