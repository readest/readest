import { describe, it, expect, vi } from 'vitest';
import {
  selectReadingWidgetBooks,
  computeReadingPercent,
  buildReadingWidgetPayload,
} from '@/services/widget/readingWidget';
import type { Book } from '@/types/book';

vi.mock('@/utils/bridge', () => ({ updateReadingWidget: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: [
        {
          hash: 'a',
          title: 'Ta',
          author: 'Aa',
          format: 'EPUB',
          updatedAt: 2,
          progress: [1, 2],
          readingStatus: 'reading',
        },
        {
          hash: 'b',
          title: 'Tb',
          author: 'Ab',
          format: 'EPUB',
          updatedAt: 5,
          readingStatus: 'finished',
        },
      ],
    }),
  },
}));

const mk = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', updatedAt: 0, ...over }) as Book;

describe('computeReadingPercent', () => {
  it('rounds current/total to a 0-100 integer', () => {
    expect(computeReadingPercent(mk({ progress: [72, 100] }))).toBe(72);
    expect(computeReadingPercent(mk({ progress: [1, 3] }))).toBe(33);
  });
  it('is 0 when progress missing or total is 0', () => {
    expect(computeReadingPercent(mk({}))).toBe(0);
    expect(computeReadingPercent(mk({ progress: [1, 0] }))).toBe(0);
  });
  it('clamps to 100', () => {
    expect(computeReadingPercent(mk({ progress: [120, 100] }))).toBe(100);
  });
});

describe('selectReadingWidgetBooks', () => {
  it('keeps only currently-reading books and sorts by updatedAt desc', () => {
    const books = [
      mk({ hash: 'a', updatedAt: 10, progress: [1, 2] }), // reading (no explicit status)
      mk({ hash: 'r', updatedAt: 35, progress: [1, 2], readingStatus: 'reading' }),
      mk({ hash: 'b', updatedAt: 30, progress: [1, 2], readingStatus: 'unread' }), // parked
      mk({ hash: 'c', updatedAt: 20, progress: [1, 2], readingStatus: 'finished' }),
      mk({ hash: 'd', updatedAt: 40, progress: [1, 2], readingStatus: 'abandoned' }),
      mk({ hash: 'e', updatedAt: 50, progress: [1, 2], deletedAt: 123 }), // deleted
      mk({ hash: 'n', updatedAt: 60, progress: undefined }), // newly imported, never opened
    ];
    expect(selectReadingWidgetBooks(books).map((b) => b.hash)).toEqual(['r', 'a']);
  });
  it('caps at the limit', () => {
    const books = [1, 2, 3, 4].map((n) => mk({ hash: String(n), updatedAt: n, progress: [1, 2] }));
    expect(selectReadingWidgetBooks(books, 3)).toHaveLength(3);
  });
});

import { refreshReadingWidget } from '@/services/widget/readingWidget';

const appServiceForBuild = {
  isMobileApp: true,
  resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
} as unknown as import('@/types/system').AppService;

const labelsForBuild = { sectionTitle: 'Continue reading', emptyTitle: 'Empty' };
const booksForBuild: Book[] = [mk({ hash: 'x', updatedAt: 1, progress: [1, 4] })];

describe('buildReadingWidgetPayload', () => {
  it('includes tts field when provided', async () => {
    const payload = await buildReadingWidgetPayload(
      booksForBuild,
      appServiceForBuild,
      labelsForBuild,
      {
        active: true,
        playing: false,
      },
    );
    expect(payload.tts).toEqual({ active: true, playing: false });
  });

  it('omits tts key when not provided', async () => {
    const payload = await buildReadingWidgetPayload(
      booksForBuild,
      appServiceForBuild,
      labelsForBuild,
    );
    expect('tts' in payload).toBe(false);
  });
});

describe('refreshReadingWidget', () => {
  const appService = {
    isMobileApp: true,
    resolveFilePath: vi.fn().mockResolvedValue('/data/Books'),
  } as unknown as import('@/types/system').AppService;

  it('skips when not a mobile app', async () => {
    const { updateReadingWidget } = await import('@/utils/bridge');
    await refreshReadingWidget({ ...appService, isMobileApp: false } as never, {
      sectionTitle: 'Continue reading',
      emptyTitle: 'Empty',
    });
    expect(updateReadingWidget).not.toHaveBeenCalled();
  });

  it('selects in-progress books and resolves cover paths', async () => {
    const { updateReadingWidget } = await import('@/utils/bridge');
    await refreshReadingWidget(appService, {
      sectionTitle: 'Continue reading',
      emptyTitle: 'Empty',
    });
    expect(updateReadingWidget).toHaveBeenCalledWith({
      books: [
        { hash: 'a', title: 'Ta', author: 'Aa', percent: 50, coverPath: '/data/Books/a/cover.png' },
      ],
      sectionTitle: 'Continue reading',
      emptyTitle: 'Empty',
    });
  });
});
