import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BookshelfFilterEditor from '@/app/library/components/BookshelfFilterEditor';
import { discoverBookshelfFields } from '@/services/bookshelves/fields';
import type { Book } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

afterEach(cleanup);

describe('BookshelfFilterEditor field picker', () => {
  // A Calibre column can share a built-in field's name ("Pages" from Count
  // Pages vs Readest's own page count, #6662); the picker must tell them apart.
  it('lists Calibre columns in their own group, apart from same-named built-in fields', () => {
    const book = {
      hash: 'h',
      format: 'EPUB',
      title: 't',
      author: 'a',
      createdAt: 0,
      updatedAt: 0,
      metadata: {
        title: 't',
        author: 'a',
        language: 'en',
        calibreColumns: [{ label: '#pages', name: 'Pages', datatype: 'int', value: 320 }],
      },
    } as Book;
    render(
      <BookshelfFilterEditor
        group={{
          type: 'group',
          match: 'all',
          children: [{ type: 'rule', field: 'pages', kind: 'number', operator: 'gt', value: 100 }],
        }}
        fields={discoverBookshelfFields([book])}
        onChange={vi.fn()}
      />,
    );

    const picker = screen.getByLabelText('Filter field');
    const builtIn = picker.querySelector(':scope > option[value="pages"]');
    const calibre = picker.querySelector(
      'optgroup[label="Calibre"] > option[value="calibre:#pages"]',
    );
    expect(builtIn?.textContent).toBe('Pages');
    expect(calibre?.textContent).toBe('Pages');
  });
});
