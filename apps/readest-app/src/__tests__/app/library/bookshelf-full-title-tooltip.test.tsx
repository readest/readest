import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book, BooksGroup } from '@/types/book';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { librarySkeuomorphicCovers: false } }),
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

import BookItem from '@/app/library/components/BookItem';
import GroupItem from '@/app/library/components/GroupItem';

const longTitle = 'The Remarkably Long Title of a Book That Never Fits on One Shelf Line';
const book: Book = {
  hash: 'long',
  title: longTitle,
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
const group: BooksGroup = {
  id: 'g1',
  name: 'series',
  displayName: 'A Series Name Long Enough To Be Cut Off On The Shelf',
  books: [book],
  updatedAt: 1,
};

afterEach(cleanup);

// The shelf cuts titles to one line, so the full title shows on hover (#6783).
describe.each(['grid', 'list'] as const)('full title on hover in %s mode', (mode) => {
  it('gives a book title its full text as a tooltip', () => {
    render(
      <BookItem
        mode={mode}
        book={book}
        coverFit='crop'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={vi.fn()}
        showTimeRemaining={false}
      />,
    );
    expect(screen.getByText(longTitle).getAttribute('title')).toBe(longTitle);
  });

  it('gives a group name its full text as a tooltip', () => {
    render(<GroupItem mode={mode} group={group} isSelectMode={false} groupSelected={false} />);
    const label = screen.getByText(group.displayName);
    expect(label.getAttribute('title')).toBe(group.displayName);
  });
});
