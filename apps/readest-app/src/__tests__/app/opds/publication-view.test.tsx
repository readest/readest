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
  // Mirrors i18next interpolation so `Download {{format}}` renders like it does
  // in the app instead of leaking the placeholder into assertions.
  useTranslation: () => (s: string, opts?: Record<string, string>) =>
    opts ? s.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(opts[key] ?? '')) : s,
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: ({ cacheVersion }: { cacheVersion?: string }) => (
    <div data-testid='cached-image' data-cache-version={cacheVersion ?? ''} />
  ),
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

  it("passes the entry's Atom updated value to the cover so a replaced cover refreshes (issue #5492)", () => {
    const updatedPublication: OPDSPublication = {
      metadata: {
        title: 'Replaced Cover Entry',
        updated: '2025-06-01T00:00:00Z',
      },
      links: [],
      images: [{ rel: 'http://opds-spec.org/image', href: '/covers/1.jpg' }],
    };

    render(
      <DropdownProvider>
        <PublicationView
          publication={updatedPublication}
          baseURL='https://catalog.example.com/opds'
          resolveURL={(href, base) => new URL(href, base).toString()}
          onDownload={vi.fn(async () => null)}
          onNavigate={vi.fn()}
          onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        />
      </DropdownProvider>,
    );

    expect(screen.getByTestId('cached-image').getAttribute('data-cache-version')).toBe(
      '2025-06-01T00:00:00Z',
    );
  });

  // readest issue #5583
  describe('download format selection', () => {
    const acq = (href: string, type?: string, title?: string) => ({
      rel: REL.ACQ,
      href,
      ...(type ? { type } : {}),
      ...(title ? { title } : {}),
    });

    const renderWith = (links: OPDSPublication['links'], onDownload = vi.fn(async () => null)) => {
      render(
        <DropdownProvider>
          <PublicationView
            publication={{ metadata: { title: 'Formats' }, links, images: [] }}
            baseURL='https://calibre.example.com/opds'
            resolveURL={(href, base) => new URL(href, base).toString()}
            onDownload={onDownload}
            onNavigate={vi.fn()}
            onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
          />
        </DropdownProvider>,
      );
      return onDownload;
    };

    it('hides formats Readest cannot import, collapsing to a one-click download', () => {
      const onDownload = renderWith([
        acq('/get/kfx/56/Calibre_Library'),
        acq('/get/epub/56/Calibre_Library', 'application/epub+zip'),
      ]);

      const button = screen.getByRole('button', { name: 'Download EPUB' });
      fireEvent.click(button);

      expect(onDownload).toHaveBeenCalledWith(
        '/get/epub/56/Calibre_Library',
        'application/epub+zip',
        expect.any(Function),
      );
      expect(screen.queryByText('KFX')).toBeNull();
    });

    const mixedFormats = [
      acq('/get/pdf/1/lib', 'application/pdf'),
      acq('/get/epub/1/lib', 'application/epub+zip'),
      acq('/get/mobi/1/lib', 'application/x-mobipocket-ebook'),
    ];

    it('downloads the EPUB on the primary click even when it is not first in the feed', () => {
      const onDownload = renderWith(mixedFormats);

      fireEvent.click(screen.getByRole('button', { name: 'Download EPUB' }));

      expect(onDownload).toHaveBeenCalledWith(
        '/get/epub/1/lib',
        'application/epub+zip',
        expect.any(Function),
      );
    });

    it('keeps every format reachable behind the caret, best first', () => {
      renderWith(mixedFormats);

      fireEvent.click(screen.getByRole('button', { name: 'More formats' }));

      const entries = screen.getAllByText(/^(EPUB|MOBI|PDF)$/).map((el) => el.textContent);
      expect(entries).toEqual(['EPUB', 'MOBI', 'PDF']);
    });

    // The issue explicitly asks not to fall back to the next available format,
    // so with no EPUB the button has no default action.
    it('offers no default action when the preferred format is absent', () => {
      const onDownload = renderWith([
        acq('/get/pdf/1/lib', 'application/pdf'),
        acq('/get/mobi/1/lib', 'application/x-mobipocket-ebook'),
      ]);

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));

      expect(onDownload).not.toHaveBeenCalled();
      expect(screen.getByText('PDF')).toBeTruthy();
      expect(screen.getByText('MOBI')).toBeTruthy();
    });

    // Filtering must never strip a book's only path to a file.
    it('still lists the links when every format is incompatible', () => {
      renderWith([acq('/get/kfx/1/lib'), acq('/get/lit/1/lib')]);

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(screen.getByText('KFX')).toBeTruthy();
      expect(screen.getByText('LIT')).toBeTruthy();
    });

    it('names a single non-preferred format instead of a bare Download', () => {
      renderWith([acq('/get/pdf/1/lib', 'application/pdf')]);
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy();
    });

    // Was `idx.toString()`, so an unrecognised format rendered as "0"/"1".
    it('never labels a menu entry with its array index', () => {
      renderWith([acq('/download/1'), acq('/download/2')]);

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(screen.queryByText('0')).toBeNull();
      expect(screen.queryByText('1')).toBeNull();
    });
  });
});
