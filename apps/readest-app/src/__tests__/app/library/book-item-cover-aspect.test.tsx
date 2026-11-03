import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
// A cached cover reports its size while mounting, before React flushes the
// mount's passive effects (a carousel remounts covers scrolled back into view).
vi.mock('@/components/BookCover', () => ({
  default: ({ onAspectRatioChange }: { onAspectRatioChange?: (ratio: number) => void }) => (
    <div ref={(el) => void (el && onAspectRatioChange?.(1))} />
  ),
}));

const book: Book = {
  hash: 'square',
  title: 'Square',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
const props = {
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
};
afterEach(cleanup);

describe('fit cover sizing', () => {
  it('keeps the aspect ratio a cached cover reports before the mount effects run', () => {
    const { container } = render(<BookItem {...props} book={book} mode='grid' coverFit='fit' />);
    const main = container.querySelector<HTMLElement>('.bookitem-main');
    // jsdom drops `aspect-ratio` styles, so check the default cell shape is gone.
    expect(main?.classList.contains('aspect-28/41')).toBe(false);
  });
});
