import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OPDSPublication } from '@/types/opds';
import { PublicationCard } from '@/app/opds/components/PublicationCard';

vi.mock('@/components/CachedImage', () => ({
  CachedImage: ({ cacheVersion }: { cacheVersion?: string }) => (
    <div data-testid='cached-image' data-cache-version={cacheVersion ?? ''} />
  ),
}));

const publication: OPDSPublication = {
  metadata: {
    title: 'Updated Cover Entry',
    updated: '2025-06-01T00:00:00Z',
  },
  links: [],
  images: [{ rel: 'http://opds-spec.org/image', href: '/covers/1.jpg' }],
};

describe('PublicationCard cover cache version (issue #5492)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes the entry's Atom updated value so a replaced cover invalidates the cache", () => {
    render(
      <PublicationCard
        publication={publication}
        baseURL='https://catalog.example.com/opds'
        onClick={vi.fn()}
        resolveURL={(href, base) => new URL(href, base).toString()}
        onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
      />,
    );

    expect(screen.getByTestId('cached-image').getAttribute('data-cache-version')).toBe(
      '2025-06-01T00:00:00Z',
    );
  });
});
