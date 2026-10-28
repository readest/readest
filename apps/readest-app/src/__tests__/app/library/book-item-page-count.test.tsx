import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, params?: Record<string, unknown>) => {
    if (params?.['count'] !== undefined) return text.replace('{{count}}', String(params['count']));
    return text;
  },
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const bookWithPages: Book = {
  hash: 'paged-book',
  title: 'Dune',
  author: 'Frank Herbert',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  pageCount: 412,
};

const bookWithProgressPages: Book = {
  hash: 'progress-paged-book',
  title: 'Neuromancer',
  author: 'William Gibson',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [10, 271],
};

const audiobook: Book = {
  hash: 'audio-book',
  title: 'Audio Journey',
  author: 'Story Teller',
  format: 'ABS',
  createdAt: 1,
  updatedAt: 1,
  pageCount: 300,
  duration: 3600,
};

const props = {
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
};

afterEach(() => {
  cleanup();
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      libraryShowPageCount: false,
    },
  });
});

describe('page count badge on library covers (#6909)', () => {
  it('badges the cover with the page count when showPageCount is true via props', () => {
    const { container } = render(
      <BookItem {...props} book={bookWithPages} mode='grid' showPageCount={true} />,
    );
    const badge = screen.getByText('412p');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('aria-label')).toBe('412 pages');
    expect(container.querySelector('.bookitem-main')!.contains(badge)).toBe(true);
  });

  it('badges the cover using progress[1] total pages fallback when pageCount is not set', () => {
    render(<BookItem {...props} book={bookWithProgressPages} mode='grid' showPageCount={true} />);
    const badge = screen.getByText('271p');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('aria-label')).toBe('271 pages');
  });

  it('shows no badge when showPageCount is false', () => {
    render(<BookItem {...props} book={bookWithPages} mode='grid' showPageCount={false} />);
    expect(screen.queryByText('412p')).toBeNull();
  });

  it('reads showPageCount from useSettingsStore when prop is omitted', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        libraryShowPageCount: true,
      },
    });
    render(<BookItem {...props} book={bookWithPages} mode='grid' />);
    expect(screen.getByText('412p')).toBeTruthy();
  });

  it('does not badge audiobooks with page numbers', () => {
    render(<BookItem {...props} book={audiobook} mode='grid' showPageCount={true} />);
    expect(screen.queryByText('300p')).toBeNull();
  });

  it('shows badge in list mode as well', () => {
    const { container } = render(
      <BookItem {...props} book={bookWithPages} mode='list' showPageCount={true} />,
    );
    const badge = screen.getByText('412p');
    expect(badge).toBeTruthy();
    expect(container.querySelector('.bookitem-main')!.contains(badge)).toBe(true);
  });

  it('coexists with seriesIndex badge without colliding', () => {
    const { container } = render(
      <BookItem {...props} book={bookWithPages} mode='grid' seriesIndex={3} showPageCount={true} />,
    );
    const pageBadge = screen.getByText('412p');
    const seriesBadge = screen.getByText('#3');
    expect(pageBadge).toBeTruthy();
    expect(seriesBadge).toBeTruthy();
    expect(pageBadge.className).toContain('start-1');
    expect(seriesBadge.className).toContain('end-1');
    expect(container.querySelector('.bookitem-main')!.contains(pageBadge)).toBe(true);
    expect(container.querySelector('.bookitem-main')!.contains(seriesBadge)).toBe(true);
  });
});
