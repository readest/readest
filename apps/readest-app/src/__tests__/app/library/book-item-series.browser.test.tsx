import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));
await import('@/styles/globals.css');
afterEach(cleanup);

const book: Book = {
  hash: 'series',
  title: 'Book Twelve',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  metadata: {
    title: 'Book Twelve',
    author: 'Author',
    language: 'en',
    series: 'Series',
    seriesIndex: 12.5,
  },
};
const props = {
  mode: 'grid' as const,
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
  seriesIndex: 12.5,
};

describe('series index badge placement (#6347)', () => {
  for (const [direction, eink] of [
    ['ltr', false],
    ['rtl', false],
    ['ltr', true],
  ] as const) {
    it(`sits in the cover's top-end corner in ${direction}${eink ? ' e-ink' : ''}`, () => {
      const { container } = render(
        <div dir={direction} data-eink={eink ? 'true' : undefined} style={{ width: 110 }}>
          <BookItem {...props} book={book} />
        </div>,
      );
      const cover = container.querySelector('.bookitem-main')!.getBoundingClientRect();
      const badge = screen.getByText('#12.5').getBoundingClientRect();
      expect(badge.top - cover.top).toBeGreaterThanOrEqual(0);
      expect(badge.top - cover.top).toBeLessThan(8);
      const endGap = direction === 'ltr' ? cover.right - badge.right : badge.left - cover.left;
      expect(endGap).toBeGreaterThanOrEqual(0);
      expect(endGap).toBeLessThan(8);
      expect(badge.width).toBeLessThan(cover.width / 2);
      if (eink) {
        const style = getComputedStyle(screen.getByText('#12.5'));
        expect(style.borderTopWidth).toBe('1px');
        expect(style.boxShadow).toBe('none');
      }
    });
  }
});
