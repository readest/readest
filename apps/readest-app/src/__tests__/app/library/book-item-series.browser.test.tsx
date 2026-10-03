import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const seriesName = 'A very long series name that cannot fit on one narrow library card';
const book: Book = {
  hash: 'series',
  title: 'Book Two',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [5, 10],
  metadata: {
    title: 'Book Two',
    author: 'Author',
    language: 'en',
    series: seriesName,
    seriesIndex: 2,
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
};

describe('series metadata in narrow library grid cards (#6347)', () => {
  for (const [direction, eink] of [
    ['ltr', false],
    ['rtl', false],
    ['ltr', true],
    ['rtl', true],
  ] as const) {
    it(`keeps a long series between the title and progress in ${direction}${eink ? ' e-ink' : ''}`, () => {
      const { container } = render(
        <div
          dir={direction}
          data-eink={eink ? 'true' : undefined}
          style={{
            width: 240,
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          }}
        >
          <BookItem {...props} book={book} />
          <BookItem
            {...props}
            book={{ ...book, hash: 'standalone', title: 'Standalone', metadata: undefined }}
          />
        </div>,
      );
      const series = screen.getByText(`${seriesName} #2`);
      const title = screen.getByRole('heading', { name: 'Book Two' });
      const cards = container.querySelectorAll<HTMLElement>('.book-item');
      const progress = within(cards[0]!).getByRole('status');
      const bounds = series.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom);
      // The existing 15px progress row centers a 16px text line box.
      expect(bounds.bottom).toBeLessThanOrEqual(progress.getBoundingClientRect().top + 1);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.height).toBeCloseTo(parseFloat(getComputedStyle(series).lineHeight), 1);
      expect(bounds.width).toBeLessThanOrEqual(cards[0]!.getBoundingClientRect().width);
      expect(series.textContent).toBe(`${seriesName} #2`);
      expect(cards[1]!.querySelector('p')).toBeNull();
      // Existing action hit areas extend beyond the card with negative margins.
      // Series metadata must not add overflow beyond the standalone card.
      expect(cards[0]!.scrollWidth - cards[0]!.clientWidth).toBeLessThanOrEqual(
        cards[1]!.scrollWidth - cards[1]!.clientWidth,
      );
      expect(cards[0]!.scrollHeight - cards[0]!.clientHeight).toBeLessThanOrEqual(
        cards[1]!.scrollHeight - cards[1]!.clientHeight,
      );
      if (eink) expect(getComputedStyle(series).color).toBe(getComputedStyle(title).color);
    });
  }
});
