import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OPDSSearch } from '@/types/opds';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import { SearchView } from '@/app/opds/components/SearchView';

afterEach(() => {
  cleanup();
});

describe('SearchView', () => {
  // Each search field's label named nothing, so a screen reader announced
  // only the placeholder and tapping the label didn't focus the field (#7911).
  // The required marker stays out of the name: `required` already says it.
  it('names each search field by its own label', () => {
    const search: OPDSSearch = {
      metadata: {},
      search: () => '',
      params: [{ name: 'title' }, { name: 'author' }, { name: 'searchTerms', required: true }],
    };
    render(
      <SearchView search={search} baseURL='' onNavigate={vi.fn()} resolveURL={(url) => url} />,
    );

    const title = screen.getByLabelText('Title');
    const author = screen.getByLabelText('Author');
    const terms = screen.getByRole<HTMLInputElement>('searchbox', {
      name: 'Title, Author, Tag, etc...',
    });
    expect(new Set([title, author, terms]).size).toBe(3);
    expect(terms.type).toBe('search');
    expect(terms.required).toBe(true);
  });
});
