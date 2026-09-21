import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const book: Book = {
  hash: 'audio',
  title: 'Audiobook',
  author: 'Author',
  format: 'ABS',
  createdAt: 1,
  updatedAt: 1,
  duration: 3600,
  progress: [3600, 3600],
  readingStatus: 'finished',
};
const props = {
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: true,
};
afterEach(cleanup);
describe('audiobook status on library cards', () => {
  for (const format of ['ABS', 'OPDSAUDIO', 'BOOKORBIT'] as const) {
    for (const mode of ['grid', 'list'] as const) {
      it(`shows the Finished badge instead of -0s for ${format} in ${mode}`, () => {
        render(<BookItem {...props} book={{ ...book, format }} mode={mode} />);
        expect(screen.getByRole('status').textContent).toBe('Finished');
        expect(screen.queryByText('-0s')).toBeNull();
        expect(screen.getByLabelText('Audiobook')).toBeTruthy();
      });
    }
  }
  it('updates the badge when status changes, even before playback reaches the end', () => {
    const playing: Book = { ...book, progress: [1800, 3600], readingStatus: 'reading' };
    const { rerender } = render(<BookItem {...props} book={playing} mode='grid' />);
    expect(screen.getByRole('status').textContent).toBe('-30m');
    rerender(<BookItem {...props} book={{ ...playing, readingStatus: 'finished' }} mode='grid' />);
    expect(screen.getByRole('status').textContent).toBe('Finished');
    expect(screen.queryByText('-30m')).toBeNull();
    rerender(<BookItem {...props} book={{ ...playing, readingStatus: undefined }} mode='grid' />);
    expect(screen.getByRole('status').textContent).toBe('-30m');
  });
  it('shows the Finished badge without any playback progress', () => {
    render(<BookItem {...props} book={{ ...book, progress: undefined }} mode='grid' />);
    expect(screen.getByRole('status').textContent).toBe('Finished');
    expect(screen.queryByText('1h 0m')).toBeNull();
  });
  it('keeps episode counts on unfinished podcasts', () => {
    render(
      <BookItem
        {...props}
        book={{ ...book, absMediaType: 'podcast', readingStatus: undefined, episodeCount: 12 }}
        mode='grid'
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('12 episodes');
  });
});
