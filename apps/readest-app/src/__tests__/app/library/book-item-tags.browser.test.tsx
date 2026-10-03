import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));
await import('@/styles/globals.css');
afterEach(cleanup);

const book: Book = {
  hash: 'tagged',
  title: 'Tagged',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  tags: ['Fiction', 'Sci-Fi'],
};
const props = {
  mode: 'list' as const,
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
};
const left = (el: Element) => el.getBoundingClientRect().left;
const renderRow = (item: Book) => {
  render(
    <div style={{ width: 360 }}>
      <BookItem {...props} book={item} />
    </div>,
  );
  const tags = screen.getByLabelText('Tags');
  return { title: screen.getByRole('heading', { name: 'Tagged' }), chip: tags.firstElementChild! };
};

describe('book tags in a list row', () => {
  // A book with nothing to show still renders an empty progress element, and a
  // book with no progress or status renders none at all; neither may push the
  // tags away from the row's start.
  for (const [name, item] of [
    ['no progress', book],
    ['an empty progress', { ...book, readingStatus: 'unread' as const }],
  ] as const) {
    it(`starts the tags at the row's start with ${name}`, () => {
      const { title, chip } = renderRow(item);
      expect(left(chip)).toBeCloseTo(left(title), 1);
    });
  }

  it('keeps a gap between the progress and the tags', () => {
    const { chip } = renderRow({ ...book, progress: [5, 10] });
    const progress = screen.getByRole('status');
    expect(left(chip) - progress.getBoundingClientRect().right).toBeCloseTo(6, 1);
  });
});
