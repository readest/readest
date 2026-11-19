import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReadingHeatmap from '@/components/stats/ReadingHeatmap';
import ReadingTimeChart from '@/components/stats/ReadingTimeChart';

const env = vi.hoisted(() => ({ appService: {}, envConfig: {} }));
const db = vi.hoisted(() => ({
  open: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => env }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, p?: Record<string, unknown>) =>
    p ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k] ?? '')) : s,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'de-DE',
}));
vi.mock('@/services/statistics/statisticsDb', () => ({ StatisticsDb: db }));
const sync = vi.hoisted(() => ({ user: null as object | null, pullStats: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: sync.user }) }));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => true }));
vi.mock('@/services/statistics/statsSync', () => ({ pullStats: sync.pullStats }));
vi.mock('@/libs/sync', () => ({ SyncClient: class {} }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReadingHeatmap keyboard access', () => {
  it('moves the selected day with arrow keys and announces it', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingHeatmap daily={new Map([['2026-10-22', 1800]])} />);
    const grid = screen.getByRole('group', { name: 'Reading activity' });
    const status = screen.getByRole('status');

    fireEvent.focus(grid);
    expect(status.textContent).toContain('21');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(status.textContent).toContain('22');
    expect(status.textContent).toContain('30m');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(status.textContent).toContain('15');
  });
});

describe('ReadingTimeChart keyboard access', () => {
  it('is one tab stop whose arrow keys step through the bars', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingTimeChart daily={new Map([['2026-10-20', 1800]])} />);
    const chart = screen.getByRole('group', { name: 'Reading Time' });
    expect(chart.querySelectorAll('button')).toHaveLength(0);
    const status = screen.getByRole('status');

    fireEvent.focus(chart);
    expect(status.textContent).toContain('21');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(status.textContent).toContain('20');
    expect(screen.getByText('30m')).toBeTruthy();
  });
});

describe('ReadingTimeChart calendar periods', () => {
  // Wednesday: the week so far is Sunday 10-18 to today, and 10-16 is last week.
  const daily = new Map([
    ['2026-10-16', 1800],
    ['2026-10-20', 600],
  ]);

  it('shows the calendar week so far and steps back to the previous one', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingTimeChart daily={daily} />);
    const status = screen.getByRole('status');
    const previous = screen.getByRole('button', { name: 'Previous Week' });
    const next = screen.getByRole('button', { name: 'Next Week' });

    // 10 minutes over the four days read so far, Sunday to today.
    expect(status.textContent).toBe('10mDaily average 2m');
    expect(next).toHaveProperty('disabled', true);
    expect(previous).toHaveProperty('disabled', false);

    fireEvent.click(previous);
    expect(status.textContent).toBe('30mDaily average 4m');
    // Nothing was read before that week.
    expect(previous).toHaveProperty('disabled', true);
    expect(next).toHaveProperty('disabled', false);
    fireEvent.click(next);
    expect(status.textContent).toBe('10mDaily average 2m');
  });

  it('labels the month and year it shows, and opens on the current one', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(<ReadingTimeChart daily={new Map([...daily, ['2026-09-05', 60]])} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(screen.getByText('Oktober 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Year' }));
    expect(screen.getByText('2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous Year' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toContain('41m');
  });

  it('leaves readings dated after today out of the total and the scale', () => {
    // A synced device whose clock runs ahead can store a reading for Friday.
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    const { container } = render(
      <ReadingTimeChart daily={new Map([...daily, ['2026-10-23', 3600]])} />,
    );
    expect(screen.getByRole('status').textContent).toBe('10mDaily average 2m');
    // 10-20 is the week's longest reading so far, so its bar is full height.
    expect(container.querySelector<HTMLElement>('[data-index="2"] > span')!.style.height).toBe(
      '100%',
    );
    // October's bar is the current month: it holds 10-16 and 10-20, not 10-23.
    fireEvent.click(screen.getByRole('radio', { name: 'Year' }));
    expect(screen.getByRole('status').textContent).toMatch(/^40mDaily average/);
  });

  it('does not select days that have not come yet', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    const { container } = render(<ReadingTimeChart daily={daily} />);
    const chart = screen.getByRole('group', { name: 'Reading Time' });
    const status = screen.getByRole('status');

    fireEvent.focus(chart);
    expect(status.textContent).toContain('21');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(status.textContent).toContain('21');
    expect(container.querySelectorAll('[data-index]')).toHaveLength(4);
  });
});

describe('pointer behavior', () => {
  it('leaves the headline and footer alone on hover, and selects on click', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    const daily = new Map([['2026-10-20', 1800]]);
    const { container } = render(
      <>
        <ReadingTimeChart daily={daily} />
        <ReadingHeatmap daily={daily} />
      </>,
    );
    const [chartStatus, heatmapStatus] = screen.getAllByRole('status');
    const chartBefore = chartStatus!.textContent;
    const heatmapBefore = heatmapStatus!.textContent;
    // The week runs Sunday 10-18 to Saturday 10-24, so 10-20 is its third bar.
    const bar = container.querySelector('[data-index="2"]')!;
    const day = container.querySelector('[data-date="2026-10-20"]')!;

    fireEvent.mouseOver(bar);
    fireEvent.mouseOver(day);
    expect(chartStatus!.textContent).toBe(chartBefore);
    expect(heatmapStatus!.textContent).toBe(heatmapBefore);

    fireEvent.pointerDown(bar);
    fireEvent.click(bar);
    expect(chartStatus!.textContent).toContain('20');
    fireEvent.click(bar);
    expect(chartStatus!.textContent).toBe(chartBefore);

    fireEvent.click(day);
    expect(heatmapStatus!.textContent).toContain('20');
    expect(heatmapStatus!.textContent).toContain('30m');
  });
});

describe('arrow keys inside a Dialog', () => {
  // Dialog stops every keydown at its own node, before React's root listener.
  const InDialog = ({ children }: { children: React.ReactNode }) => (
    <div ref={(el) => el?.addEventListener('keydown', (e) => e.stopPropagation())}>{children}</div>
  );

  it('still steps the chart and the heatmap', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00'), toFake: ['Date'] });
    render(
      <InDialog>
        <ReadingTimeChart daily={new Map()} />
        <ReadingHeatmap daily={new Map()} />
      </InDialog>,
    );
    const [chartStatus, heatmapStatus] = screen.getAllByRole('status');
    const chart = screen.getByRole('group', { name: 'Reading Time' });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(chartStatus!.textContent).toContain('20');

    const heatmap = screen.getByRole('group', { name: 'Reading activity' });
    fireEvent.focus(heatmap);
    fireEvent.keyDown(heatmap, { key: 'ArrowDown' });
    expect(heatmapStatus!.textContent).toContain('22');
  });
});

describe('ReadingStatsDialog', () => {
  const openDialog = async () => {
    const { default: ReadingStatsDialog, setReadingStatsDialogVisible } = await import(
      '@/components/stats/ReadingStatsDialog'
    );
    render(<ReadingStatsDialog />);
    await act(async () => setReadingStatsDialogVisible(true));
  };

  it('formats all-time counts with the app locale', async () => {
    db.open.mockResolvedValue({
      getQuarterHourDurations: async () => [],
      getBookQuarterHourDurations: async () => [],
      getReadingTotals: async () => ({ seconds: 0, books: 1234, pages: 56789 }),
    });
    await openDialog();
    expect(await screen.findByText('56.789')).toBeTruthy();
    expect(screen.getByText('1.234')).toBeTruthy();
  });

  it("pulls the account's stats from other devices, then shows them", async () => {
    let pulled = false;
    sync.user = { id: 'u' };
    sync.pullStats.mockImplementation(async () => {
      pulled = true;
    });
    db.open.mockResolvedValue({
      getQuarterHourDurations: async () => [],
      getBookQuarterHourDurations: async () => [],
      getReadingTotals: async () => ({ seconds: 0, books: pulled ? 40 : 3, pages: 0 }),
    });
    await openDialog();
    expect(sync.pullStats).toHaveBeenCalled();
    expect(await screen.findByText('40')).toBeTruthy();
    sync.user = null;
  });

  it('says so when the statistics fail to load', async () => {
    db.open.mockRejectedValue(new Error('locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openDialog();
    expect(await screen.findByText('Failed to load reading statistics')).toBeTruthy();
  });

  it('opens the calendar from a compact entry below the heatmap and returns to statistics', async () => {
    const calendarQuery = vi.fn(async () => []);
    db.open.mockResolvedValue({
      getQuarterHourDurations: async () => [],
      getBookQuarterHourDurations: calendarQuery,
      getReadingTotals: async () => ({ seconds: 0, books: 0, pages: 0 }),
    });
    await openDialog();
    await screen.findByText('All Time');
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    const entry = screen.getByRole('button', { name: 'Reading Calendar' });
    const heatmap = screen.getByRole('group', { name: 'Reading activity' });
    expect(heatmap.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calendarQuery).not.toHaveBeenCalled();

    fireEvent.click(entry);
    expect(await screen.findByRole('group', { name: 'Reading Calendar' })).toBeTruthy();
    expect(screen.queryByText('All Time')).toBeNull();
    expect(calendarQuery).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reading Statistics' }));
    expect(screen.getByText('All Time')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading Calendar' }));
  });
  it('goes back to statistics, not out of the dialog, when closed from the calendar', async () => {
    db.open.mockResolvedValue({
      getQuarterHourDurations: async () => [],
      getBookQuarterHourDurations: async () => [],
      getReadingTotals: async () => ({ seconds: 0, books: 0, pages: 0 }),
    });
    await openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Reading Calendar' }));
    await screen.findByRole('group', { name: 'Reading Calendar' });

    // Escape, the Android back key and the mobile header arrow all call Dialog's onClose.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('All Time')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Reading Calendar' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reading Calendar' }));

    // The mobile header arrow is named for what it does on each page.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reading Calendar' }));
    await screen.findByRole('group', { name: 'Reading Calendar' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('All Time')).toBeTruthy();

    const dialog = document.getElementById('reading_stats_window')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
