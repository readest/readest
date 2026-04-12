import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import BookCover from '@/components/BookCover';
import { Book } from '@/types/book';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

afterEach(cleanup);

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'epub',
    coverImageUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }) as Book;

describe('BookCover', () => {
  it('passes loading="lazy" to crop-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('passes loading="lazy" to fit-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='fit' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });
});
