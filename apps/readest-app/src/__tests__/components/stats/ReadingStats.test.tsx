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
    const bar = container.querySelector('[data-index="5"]')!;
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
});
