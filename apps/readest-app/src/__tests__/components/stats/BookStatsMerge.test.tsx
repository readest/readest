import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BookStats, StatBook } from '@/types/statistics';
import { eventDispatcher } from '@/utils/event';

// Merging two statistics entries of the same book (#7494), from Reading
// Statistics → Statistics by Book and from Book Details.

const env = vi.hoisted(() => ({ appService: {}, envConfig: {} }));
const db = vi.hoisted(() => ({ open: vi.fn() }));
const sync = vi.hoisted(() => ({
  user: null as object | null,
  pullStats: vi.fn(),
  deleteBookStats: vi.fn(),
  mergeBookStats: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => env }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, p?: Record<string, unknown>) =>
    p ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k] ?? '')) : s,
}));
vi.mock('@/services/statistics/statisticsDb', () => ({ StatisticsDb: db }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: sync.user }) }));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => true }));
vi.mock('@/services/statistics/statsSync', () => ({
  pullStats: sync.pullStats,
  deleteBookStats: sync.deleteBookStats,
  mergeBookStats: sync.mergeBookStats,
}));
vi.mock('@/libs/sync', () => ({ SyncClient: class SyncClient {} }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

const entry = (md5: string, title: string, seconds: number, lastRead: number): BookStats => ({
  md5,
  title,
  authors: 'Author',
  seconds,
  pages: 12,
  lastRead,
});

// A fake StatisticsDb that mergeBookStats really merges.
const fakeDb = (books: BookStats[]) => {
  let left = books;
  sync.mergeBookStats.mockImplementation(
    async (_db, _client, sources: StatBook[], target: StatBook) => {
      const from = left.filter((b) => sources.some((s) => s.bookMd5 === b.md5));
      const into = left.find((b) => b.md5 === target.bookMd5);
      left = left.filter((b) => !from.includes(b) && b !== into);
      left.unshift({
        ...(into ?? entry(target.bookMd5, target.title, 0, from[0]!.lastRead)),
        seconds: from.reduce((s, b) => s + b.seconds, into?.seconds ?? 0),
      });
    },
  );
  const fake = {
    getQuarterHourDurations: async () => [],
    getBookQuarterHourDurations: async () => [],
    getReadingTotals: async () => ({ seconds: 0, books: left.length, pages: 0 }),
    getBookStats: vi.fn(async (md5?: string) => left.filter((b) => !md5 || b.md5 === md5)),
  };
  db.open.mockResolvedValue(fake);
  return fake;
};

// "Dune" read under two files, plus a book read more recently than either.
const LIBRARY = () => [
  entry('emma', 'Emma', 60, 3000),
  entry('new', 'Dune', 12_000, 2000),
  entry('old', 'Dune', 600, 1000),
];

beforeEach(() => {
  sync.user = null;
  sync.pullStats.mockReset().mockResolvedValue(undefined);
  sync.mergeBookStats.mockReset();
});
afterEach(() => cleanup());

const pickerRows = () =>
  screen.getAllByRole('button').filter((b) => b.closest('[data-merge-picker]'));

describe('Statistics by Book: Merge', () => {
  const openBooksPage = async () => {
    const { default: ReadingStatsDialog, setReadingStatsDialogVisible } = await import(
      '@/components/stats/ReadingStatsDialog'
    );
    render(<ReadingStatsDialog />);
    await act(async () => setReadingStatsDialogVisible(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Statistics by Book' }));
    await screen.findAllByText('Dune');
  };

  it('merges an entry into another, offering same-title entries first', async () => {
    const fake = fakeDb(LIBRARY());
    await openBooksPage();
    const [, oldRow] = screen.getAllByRole('button', { name: 'Merge statistics of Dune' });
    fireEvent.click(oldRow!);

    expect(screen.getByText('Merge “Dune” into:')).toBeTruthy();
    // the other Dune comes before Emma, which was read more recently
    expect(pickerRows().map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Dune3h 20m/),
      expect.stringMatching(/^Emma1m/),
      'Cancel',
    ]);
    fireEvent.click(pickerRows()[0]!);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Merge “Dune” into “Dune”?')).toBeTruthy();
    expect(within(alert).getByText(/on this device/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(screen.getAllByText('Dune')).toHaveLength(1));
    expect(sync.mergeBookStats).toHaveBeenCalledWith(
      fake,
      null,
      [{ bookMd5: 'old', title: 'Dune', authors: 'Author' }],
      { bookMd5: 'new', title: 'Dune', authors: 'Author' },
    );
    expect(screen.getByText(/^3h 30m · /)).toBeTruthy();
  });

  it('merges several selected entries into the one picked from them (#7812)', async () => {
    const fake = fakeDb([...LIBRARY(), entry('oldest', 'Dune', 300, 500)]);
    await openBooksPage();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    const merge = screen.getByRole('button', { name: 'Merge' });
    const [, , dune2, dune3] = screen.getAllByRole('checkbox');
    fireEvent.click(dune2!);
    // merging needs two entries
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dune3!);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Dune' })[0]!);
    fireEvent.click(merge);

    expect(screen.getByText('Merge 3 entries into:')).toBeTruthy();
    // only the selected entries are offered, Emma is not
    expect(pickerRows().map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Dune3h 20m/),
      expect.stringMatching(/^Dune10m/),
      expect.stringMatching(/^Dune5m/),
      'Cancel',
    ]);
    fireEvent.click(pickerRows()[0]!);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Merge 2 entries into “Dune”?')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(screen.getAllByText('Dune')).toHaveLength(1));
    expect(sync.mergeBookStats).toHaveBeenCalledTimes(1);
    expect(sync.mergeBookStats).toHaveBeenCalledWith(
      fake,
      null,
      [
        { bookMd5: 'old', title: 'Dune', authors: 'Author' },
        { bookMd5: 'oldest', title: 'Dune', authors: 'Author' },
      ],
      { bookMd5: 'new', title: 'Dune', authors: 'Author' },
    );
    expect(screen.getByText(/^3h 35m · /)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('cancels back to the list', async () => {
    fakeDb(LIBRARY());
    await openBooksPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge statistics of Dune' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Merge “Dune” into:')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Merge statistics of Dune' })).toHaveLength(2);
  });

  it('keeps both entries and says so when the merge fails', async () => {
    fakeDb(LIBRARY());
    sync.mergeBookStats.mockRejectedValue(new Error('offline'));
    const toast = vi.spyOn(eventDispatcher, 'dispatch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openBooksPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge statistics of Dune' })[1]!);
    fireEvent.click(pickerRows()[0]!);
    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Merge' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('toast', {
        type: 'error',
        message: 'Failed to merge reading statistics',
      }),
    );
    // still picking, to retry or cancel; both entries are as they were
    expect(screen.getByText('Merge “Dune” into:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByText('Dune')).toHaveLength(2);
  });
});

describe('Book Details: Merge', () => {
  const renderSection = async (books: BookStats[], hash = 'new') => {
    fakeDb(books);
    const { default: BookStatsSection } = await import('@/components/stats/BookStatsSection');
    render(<BookStatsSection book={{ hash, title: 'Dune', author: 'Frank Herbert' }} />);
  };

  it('merges another entry into this book', async () => {
    sync.user = { id: 'u' };
    await renderSection(LIBRARY());
    fireEvent.click(await screen.findByRole('button', { name: 'Merge Statistics' }));

    expect(await screen.findByText('Merge another entry into this book:')).toBeTruthy();
    expect(pickerRows().map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Dune10m/),
      expect.stringMatching(/^Emma1m/),
      'Cancel',
    ]);
    fireEvent.click(pickerRows()[0]!);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/on all your devices/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Merge' }));

    expect(await screen.findByText('3h 30m')).toBeTruthy();
    const [, client, sources, target] = sync.mergeBookStats.mock.calls[0]!;
    expect(client.constructor.name).toBe('SyncClient');
    expect(sources).toEqual([{ bookMd5: 'old', title: 'Dune', authors: 'Author' }]);
    // the target keeps its statistics' title and authors
    expect(target).toEqual({ bookMd5: 'new', title: 'Dune', authors: 'Author' });
  });

  it('merges into a book that has no statistics yet, under its library title', async () => {
    await renderSection([entry('old', 'Dune', 600, 1000)], 'reimported');
    expect(await screen.findByText('No reading statistics yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Merge Statistics' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /^Dune/ }))[0]!);
    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Merge' }),
    );

    expect(await screen.findByText('10m')).toBeTruthy();
    expect(sync.mergeBookStats.mock.calls[0]![3]).toEqual({
      bookMd5: 'reimported',
      title: 'Dune',
      authors: 'Frank Herbert',
    });
  });

  it('says when there is nothing to merge', async () => {
    await renderSection([entry('new', 'Dune', 600, 1000)]);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge Statistics' }));
    expect(await screen.findByText('No other books have reading statistics')).toBeTruthy();
  });
});
