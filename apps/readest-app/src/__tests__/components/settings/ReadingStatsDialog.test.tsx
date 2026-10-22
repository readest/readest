import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import ReadingStatsDialog, { setReadingStatsDialogVisible } from '@/components/ReadingStatsDialog';
import ReadingHeatmap from '@/components/settings/ReadingHeatmap';
import ReadingTrendsChart from '@/components/settings/ReadingTrendsChart';
import SettingsDialog from '@/components/settings/SettingsDialog';

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? '')) : s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isMobileApp: false },
    envConfig: {},
  }),
}));

vi.mock('@/components/command-palette', () => ({
  useCommandPalette: () => ({
    open: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('@/components/settings/FontPanel', () => ({
  default: () => <div>Font Panel</div>,
}));

vi.mock('@/components/settings/StatsPanel', () => ({
  default: () => <div data-testid='stats-panel-content'>Stats Panel Content</div>,
}));

describe('ReadingStatsDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('is closed initially and opens via setReadingStatsDialogVisible', async () => {
    render(<ReadingStatsDialog />);

    expect(screen.queryByTestId('stats-panel-content')).toBeNull();

    act(() => {
      setReadingStatsDialogVisible(true);
    });

    expect(screen.getByTestId('stats-panel-content')).toBeDefined();

    act(() => {
      setReadingStatsDialogVisible(false);
    });

    await waitFor(
      () => {
        expect(screen.queryByTestId('stats-panel-content')).toBeNull();
      },
      { timeout: 1000 },
    );
  });
});

describe('ReadingHeatmap (split halves)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders top half (Jan to Jun) and next half (Jul to Dec)', () => {
    const mockData = [
      { date: '2026-02-10', totalSeconds: 1800, bookCount: 1 },
      { date: '2026-08-15', totalSeconds: 3600, bookCount: 2 },
    ];

    render(<ReadingHeatmap data={mockData} year={2026} />);

    // Check that both halves are rendered with their aria labels
    expect(screen.getByLabelText('January to June')).toBeDefined();
    expect(screen.getByLabelText('July to December')).toBeDefined();

    // Verify month labels are present
    expect(screen.getByText('Jan')).toBeDefined();
    expect(screen.getByText('Jun')).toBeDefined();
    expect(screen.getByText('Jul')).toBeDefined();
    expect(screen.getByText('Dec')).toBeDefined();
  });
});

describe('ReadingTrendsChart (Progress line chart)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders range pills, summary metrics, and chart', () => {
    const mockData = [
      { date: '2026-10-18', totalSeconds: 1800, bookCount: 1 },
      { date: '2026-10-19', totalSeconds: 3600, bookCount: 2 },
      { date: '2026-10-20', totalSeconds: 5400, bookCount: 1 },
    ];

    render(<ReadingTrendsChart data={mockData} />);

    // Check filter pills
    expect(screen.getByText('7D')).toBeDefined();
    expect(screen.getByText('1M')).toBeDefined();
    expect(screen.getByText('3M')).toBeDefined();
    expect(screen.getByText('6M')).toBeDefined();
    expect(screen.getByText('1Y')).toBeDefined();

    // Check metric labels
    expect(screen.getByText('Time')).toBeDefined();
    expect(screen.getByText('Peak Books')).toBeDefined();
    expect(screen.getByText('Est. Pages')).toBeDefined();

    // Switch range pill to 7D
    fireEvent.click(screen.getByText('7D'));
    expect(screen.getByText('7D').className).toContain('text-primary');
  });
});

describe('SettingsDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not contain Stats tab in settings', () => {
    render(<SettingsDialog bookKey='' />);

    // 'Stats' should NOT be in the tab list of SettingsDialog
    const statsTab = screen.queryByRole('tab', { name: /^stats$/i });
    expect(statsTab).toBeNull();
  });
});
