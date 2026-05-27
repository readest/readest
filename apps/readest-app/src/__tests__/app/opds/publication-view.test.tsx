import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import { REL, type OPDSPublication } from '@/types/opds';
import { PublicationView } from '@/app/opds/components/PublicationView';
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
});
