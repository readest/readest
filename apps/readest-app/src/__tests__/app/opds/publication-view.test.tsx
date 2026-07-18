import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import { REL, type OPDSPublication } from '@/types/opds';
import { PublicationView } from '@/app/opds/components/PublicationView';
import { parsePublicationDocument } from '@/app/opds/utils/opdsPublication';
import { DropdownProvider } from '@/context/DropdownContext';

const navigateToReader = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: () => <div data-testid='cached-image' />,
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader,
}));

const publication: OPDSPublication = {
  metadata: {
    title: 'Calibre Entry',
    author: [{ name: 'Author', links: [] }],
  },
  links: [
    {
      rel: `${REL.ACQ}/open-access`,
      href: '/download/book.epub',
      type: 'application/epub+zip',
      title: 'EPUB',
    },
  ],
  images: [],
};

const linkedPublication: OPDSPublication = {
  metadata: {
    title: 'Linked Entry',
    author: [
      {
        name: 'Tuttle',
        links: [{ href: '/opds/search?author_id=52836', type: 'application/opds+json' }],
      },
    ],
    subject: [
      {
        name: 'Horses -- Fiction',
        links: [{ href: '/opds/subjects?id=164', type: 'application/opds+json' }],
      },
      { name: 'Plain Tag' },
    ],
  },
  links: [],
  images: [],
};

const existingBook: Book = {
  hash: 'existing-book',
  format: 'EPUB',
  title: 'Calibre Entry',
  author: 'Author',
  createdAt: 0,
  updatedAt: 0,
};

describe('PublicationView', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps a Download Again override when a source match opens an existing book', async () => {
    const onDownload = vi.fn(async () => existingBook);

    render(
      <DropdownProvider>
        <PublicationView
          publication={publication}
          baseURL='https://calibre.example.com/opds'
          existingBook={existingBook}
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={onDownload}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download Again' }));

    await waitFor(() => {
      expect(onDownload).toHaveBeenCalledWith(
        '/download/book.epub',
        'application/epub+zip',
        expect.any(Function),
      );
    });
    expect(navigateToReader).not.toHaveBeenCalled();
  });

  it('navigates when a tag with an OPDS link is clicked', () => {
    const onNavigate = vi.fn();

    render(
      <DropdownProvider>
        <PublicationView
          publication={linkedPublication}
          baseURL='https://gutenberg.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={onNavigate}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Horses -- Fiction/ }));
    expect(onNavigate).toHaveBeenCalledWith('https://gutenberg.example.com/opds/subjects?id=164');
  });

  it('navigates when an author with an OPDS link is clicked', () => {
    const onNavigate = vi.fn();

    render(
      <DropdownProvider>
        <PublicationView
          publication={linkedPublication}
          baseURL='https://gutenberg.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={onNavigate}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tuttle' }));
    expect(onNavigate).toHaveBeenCalledWith(
      'https://gutenberg.example.com/opds/search?author_id=52836',
    );
  });

  it('renders an HTML description (OPDS 2.0 JSON) as markup, not literal tags', () => {
    // OPDS 2.0 JSON publications carry the description as a plain `description`
    // string that some catalogs (e.g. pglaf/Gutenberg) fill with HTML. It must
    // render as markup, not show literal <p>/<strong> tags (readest issue #4749).
    const htmlDescPublication: OPDSPublication = {
      metadata: {
        title: 'HTML Desc',
        description: '<p>Creators: Alice</p><p>A <strong>great</strong> book.</p>',
      },
      links: [],
      images: [],
    };

    const { container } = render(
      <DropdownProvider>
        <PublicationView
          publication={htmlDescPublication}
          baseURL='https://opds.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    expect(container.querySelector('strong')?.textContent).toBe('great');
    expect(container.textContent).not.toContain('<p>');
    expect(container.textContent).toContain('Creators: Alice');
  });

  // End-to-end for readest issue #4749: a feed lists this book with only a
  // `rel="self"` publication link (no download, no description). Dereferencing
  // that link yields the document below; rendering it must surface the
  // acquisition button, the HTML description as markup, and the metadata — the
  // same outcome Thorium produces.
  it('renders a fetched OPDS 2.0 publication document with downloads and HTML description', () => {
    const document = JSON.stringify({
      metadata: {
        title: 'Weeds used in medicine',
        author: { name: 'Henkel, Alice' },
        publisher: 'Washington: Government printing office, 1904.',
        language: 'en',
        description: '<p>Creators: Alice Henkel</p><p>A <strong>practical</strong> bulletin.</p>',
      },
      links: [
        {
          rel: 'self',
          href: '/opds/publications?id=76922',
          type: 'application/opds-publication+json',
        },
        {
          rel: 'http://opds-spec.org/acquisition/open-access',
          href: 'https://www.gutenberg.org/cache/epub/76922/pg76922-images-3.epub',
          type: 'application/epub+zip',
          title: 'EPUB3',
        },
      ],
      images: [
        {
          href: 'https://www.gutenberg.org/cache/epub/76922/pg76922.cover.medium.jpg',
          type: 'image/jpeg',
        },
      ],
    });
    const resolved = parsePublicationDocument(
      document,
      'https://opds-test.pglaf.org/opds/publications?id=76922',
    );
    expect(resolved).not.toBeNull();

    const { container } = render(
      <DropdownProvider>
        <PublicationView
          publication={resolved!}
          baseURL='https://opds-test.pglaf.org/opds/'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    // Acquisition link from the fetched document drives the download button.
    expect(screen.getByRole('button', { name: 'Open Access' })).toBeTruthy();
    // HTML description renders as markup, not literal tags.
    expect(container.querySelector('strong')?.textContent).toBe('practical');
    expect(container.textContent).not.toContain('<p>');
    // Metadata only present in the fetched document is shown.
    expect(screen.getByText('Washington: Government printing office, 1904.')).toBeTruthy();
  });

  it('restores Calibre pipe-escaped commas and joins authors with & (issue #5183)', () => {
    const calibrePublication: OPDSPublication = {
      metadata: {
        title: 'Two Authors',
        author: [
          {
            name: 'Doe| John Walter',
            links: [{ href: '/opds/search?author_id=1', type: 'application/opds+json' }],
          },
          { name: 'Smith| James Richard', links: [] },
        ],
      },
      links: [],
      images: [],
    };

    const { container } = render(
      <DropdownProvider>
        <PublicationView
          publication={calibrePublication}
          baseURL='https://calibre.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    expect(container.textContent).toContain('Doe, John Walter & Smith, James Richard');
    // Linked authors stay clickable with the normalized name.
    expect(screen.getByRole('button', { name: 'Doe, John Walter' })).toBeTruthy();
  });

  it('renders a tag without an OPDS link as plain, non-clickable text', () => {
    render(
      <DropdownProvider>
        <PublicationView
          publication={linkedPublication}
          baseURL='https://gutenberg.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Plain Tag' })).toBeNull();
    expect(screen.getByText('Plain Tag')).toBeTruthy();
  });
});
