import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BookStats } from '@/types/statistics';
import { eventDispatcher } from '@/utils/event';

// Deleting a book's reading statistics (#7494) from Reading Statistics →
// Statistics by Book, and from the Reading Statistics section of Book Details.

const env = vi.hoisted(() => ({ appService: {}, envConfig: {} }));
const db = vi.hoisted(() => ({ open: vi.fn() }));
const sync = vi.hoisted(() => ({
  user: null as object | null,
  pullStats: vi.fn(),
  deleteBookStats: vi.fn(),
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
}));
vi.mock('@/libs/sync', () => ({ SyncClient: class SyncClient {} }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

const entry = (md5: string, title: string, seconds: number): BookStats => ({
  md5,
  title,
  authors: 'Author',
  seconds,
  pages: 12,
  lastRead: 1_780_000_000,
});

// A fake StatisticsDb whose books disappear once deleteBookStats ran for them.
const fakeDb = (books: BookStats[]) => {
  let left = books;
  sync.deleteBookStats.mockImplementation(async (_db, _client, gone: { bookMd5: string }[]) => {
    left = left.filter((b) => !gone.some((g) => g.bookMd5 === b.md5));
  });
  const fake = {
    getQuarterHourDurations: async () => [],
    getBookQuarterHourDurations: async () => [],
    getReadingSpeedSamples: async () => [],
    getReadingSpeedTotals: async () => [],
    getReadingTotals: vi.fn(async () => ({
      seconds: left.reduce((s, b) => s + b.seconds, 0),
      books: left.length,
      pages: 0,
    })),
    getBookStats: vi.fn(async (md5?: string) => left.filter((b) => !md5 || b.md5 === md5)),
  };
  db.open.mockResolvedValue(fake);
  return fake;
};

beforeEach(() => {
  sync.user = null;
  sync.pullStats.mockReset().mockResolvedValue(undefined);
  sync.deleteBookStats.mockReset();
});
afterEach(() => cleanup());

const openBooksPage = async () => {
  const { default: ReadingStatsDialog, setReadingStatsDialogVisible } = await import(
    '@/components/stats/ReadingStatsDialog'
  );
  render(<ReadingStatsDialog />);
  await act(async () => setReadingStatsDialogVisible(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Statistics by Book' }));
};

describe('Statistics by Book', () => {
  it('lists every book with its reading time and deletes one on this device when signed out', async () => {
    const fake = fakeDb([entry('a', 'Dune', 12_000), entry('b', 'Dune (old copy)', 600)]);
    await openBooksPage();
    expect(await screen.findByText('Dune')).toBeTruthy();
    expect(screen.getByText(/^3h 20m · /)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete statistics of Dune (old copy)' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/removed from this device/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Dune (old copy)')).toBeNull());
    expect(sync.deleteBookStats).toHaveBeenCalledWith(fake, null, [
      { bookMd5: 'b', title: 'Dune (old copy)', authors: 'Author' },
    ]);
    expect(screen.getByText('Dune')).toBeTruthy();
    // the totals on the main page are read again
    expect(fake.getReadingTotals.mock.calls.length).toBeGreaterThan(1);
  });

  it('deletes several selected books at once (#7812)', async () => {
    const fake = fakeDb([
      entry('a', 'Dune', 600),
      entry('b', 'Dune (copy 1)', 60),
      entry('c', 'Dune (copy 2)', 60),
    ]);
    await openBooksPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    // the per-entry actions give way to checkboxes
    expect(screen.queryByRole('button', { name: 'Delete statistics of Dune' })).toBeNull();
    const deleteSelected = screen.getByRole('button', { name: 'Delete' });
    expect((deleteSelected as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dune (copy 1)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dune (copy 2)' }));
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(deleteSelected);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Delete the reading statistics of 2 books?')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Dune (copy 1)')).toBeNull());
    expect(sync.deleteBookStats).toHaveBeenCalledTimes(1);
    expect(sync.deleteBookStats).toHaveBeenCalledWith(fake, null, [
      { bookMd5: 'b', title: 'Dune (copy 1)', authors: 'Author' },
      { bookMd5: 'c', title: 'Dune (copy 2)', authors: 'Author' },
    ]);
    expect(screen.queryByText('Dune (copy 2)')).toBeNull();
    // back to the list, out of selection
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete statistics of Dune' })).toBeTruthy();
  });

  it('selects every book at once and leaves selection with Cancel', async () => {
    fakeDb([entry('a', 'Dune', 600), entry('b', 'Emma', 60)]);
    await openBooksPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(sync.deleteBookStats).not.toHaveBeenCalled();
  });

  it('deletes on every device through the sync server when stats sync is on', async () => {
    sync.user = { id: 'u' };
    fakeDb([entry('a', 'Dune', 600)]);
    await openBooksPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete statistics of Dune' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/removed from all your devices/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sync.deleteBookStats).toHaveBeenCalled());
    expect(sync.deleteBookStats.mock.calls[0]![1]?.constructor.name).toBe('SyncClient');
  });

  it('keeps the book and says so when the deletion fails', async () => {
    fakeDb([entry('a', 'Dune', 600)]);
    sync.deleteBookStats.mockRejectedValue(new Error('offline'));
    const toast = vi.spyOn(eventDispatcher, 'dispatch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openBooksPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete statistics of Dune' }));
    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('toast', {
        type: 'error',
        message: 'Failed to delete reading statistics',
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Dune')).toBeTruthy();
  });

  it('adds the books the dialog’s pull brings in while the page is open', async () => {
    sync.user = { id: 'u' };
    const books = [entry('a', 'Dune', 600)];
    fakeDb(books);
    let finishPull = () => {};
    sync.pullStats.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPull = () => {
            books.push(entry('b', 'Foundation', 300));
            resolve();
          };
        }),
    );
    await openBooksPage();
    expect(await screen.findByText('Dune')).toBeTruthy();
    expect(screen.queryByText('Foundation')).toBeNull();
    await act(async () => finishPull());
    expect(await screen.findByText('Foundation')).toBeTruthy();
  });

  it('says the list failed to load rather than that there are no statistics', async () => {
    const fake = fakeDb([entry('a', 'Dune', 600)]);
    fake.getBookStats.mockRejectedValue(new Error('locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openBooksPage();
    expect(await screen.findByText('Failed to load reading statistics')).toBeTruthy();
    expect(screen.queryByText('No reading statistics yet')).toBeNull();
  });
});

describe('Book Details: Reading Statistics', () => {
  const renderSection = async (books: BookStats[]) => {
    fakeDb(books);
    const { default: BookStatsSection } = await import('@/components/stats/BookStatsSection');
    render(<BookStatsSection book={{ hash: 'a', title: 'Dune', author: 'Author' }} />);
  };

  it('shows the book’s reading time and pages, and deletes them', async () => {
    await renderSection([entry('a', 'Dune', 12_000), entry('b', 'Other', 60)]);
    expect(await screen.findByText('3h 20m')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Statistics' }));
    fireEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Delete' }),
    );

    expect(await screen.findByText('No reading statistics yet')).toBeTruthy();
    expect(sync.deleteBookStats.mock.calls[0]![2]).toEqual([
      { bookMd5: 'a', title: 'Dune', authors: 'Author' },
    ]);
  });

  it('offers nothing to delete for a book with no statistics', async () => {
    await renderSection([entry('b', 'Other', 60)]);
    expect(await screen.findByText('No reading statistics yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete Statistics' })).toBeNull();
  });
});
