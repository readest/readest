import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReadingCalendar from '@/components/stats/ReadingCalendar';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { BookQuarterHourDuration } from '@/services/statistics/readingStats';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/misc', () => ({ getLocale: () => 'en-US' }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: (select: (state: { library: [] }) => unknown) => select({ library: [] }),
}));
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: { title: string } }) => <span data-cover={book.title} />,
}));

const quarter = (
  day: string,
  bookMd5: string,
  title: string,
  seconds = 120,
): BookQuarterHourDuration => ({
  quarter: Math.floor(new Date(`${day}T12:00:00`).getTime() / 900000),
  bookMd5,
  title,
  authors: `Author ${bookMd5}`,
  seconds,
});
const daily = new Map([
  ['2026-09-01', 60],
  ['2026-11-07', 120],
]);
const query = vi.fn<StatisticsDb['getBookQuarterHourDurations']>();
// The component only consumes the query; the real SQL is tested separately.
const db = { getBookQuarterHourDurations: query };

const pointer = (element: Element, type: string, options: PointerEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'touch' },
    isPrimary: { value: options.isPrimary ?? true },
  });
  fireEvent(element, event);
};

const touchMove = (element: Element, count = 1) => {
  const event = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({})) });
  fireEvent(element, event);
  return event;
};

const wheel = (element: Element, options: WheelEventInit, timeStamp: number) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(element, event);
  return event;
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-07T12:00:00'), toFake: ['Date'] });
  query.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReadingCalendar', () => {
  it('slides the old and new date grids in the month direction and cleans up interrupted transitions', async () => {
    const original = HTMLElement.prototype.animate;
    const cancel = vi.fn();
    const animate = vi.fn(
      () => ({ cancel, finished: new Promise(() => {}) }) as unknown as Animation,
    );
    HTMLElement.prototype.animate = animate;
    const { container, unmount } = render(<ReadingCalendar db={db} daily={daily} />);
    try {
      await screen.findByText('No reading activity on this day');
      expect(animate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
      expect(animate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ transform: 'translateX(-100%)' })]),
        expect.objectContaining({ duration: 220 }),
      );
      expect(container.querySelectorAll('[data-calendar-exit]')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
      expect(cancel).toHaveBeenCalled();
      expect(container.querySelectorAll('[data-calendar-exit]')).toHaveLength(1);
      expect(screen.getByText('November 2026')).toBeTruthy();
      unmount();
      expect(container.querySelector('[data-calendar-exit]')).toBeNull();
    } finally {
      unmount();
      if (original) HTMLElement.prototype.animate = original;
      else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it.each([
    'touch',
    'pen',
  ])('switches months with a %s swipe and suppresses its trailing click', async (pointerType) => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    const grid = container.querySelector('[aria-busy]')!;
    pointer(grid, 'pointerdown', { pointerType, clientX: 80, clientY: 150 });
    pointer(grid, 'pointermove', { pointerType, clientX: 200, clientY: 155 });
    pointer(grid, 'pointerup', { pointerType, clientX: 220, clientY: 155 });
    expect(screen.queryByText('October 2026')).not.toBeNull();
    const day = container.querySelector<HTMLButtonElement>('[data-calendar-date="2026-10-07"]')!;
    fireEvent.click(day, { detail: 1 });
    expect(screen.getByRole('button', { pressed: true }).dataset['calendarDate']).toBe(
      '2026-10-01',
    );
    pointer(day, 'pointerdown', { pointerType, clientX: 100, clientY: 150 });
    pointer(day, 'pointerup', { pointerType, clientX: 100, clientY: 150 });
    fireEvent.click(day, { detail: 1 });
    expect(screen.getByRole('button', { pressed: true }).dataset['calendarDate']).toBe(
      '2026-10-07',
    );
    pointer(grid, 'pointerdown', { pointerType, clientX: 220, clientY: 150 });
    pointer(grid, 'pointermove', { pointerType, clientX: 100, clientY: 155 });
    pointer(grid, 'pointerup', { pointerType, clientX: 80, clientY: 155 });
    expect(screen.getByText('November 2026')).toBeTruthy();
  });

  it('cancels native touch scrolling only for a claimed month swipe so the next Today tap can activate', async () => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    const grid = container.querySelector('[aria-busy]')!;
    pointer(grid, 'pointerdown', { clientX: 80, clientY: 150 });
    expect(touchMove(grid).defaultPrevented).toBe(false);
    pointer(grid, 'pointermove', { clientX: 200, clientY: 155 });
    expect(touchMove(grid).defaultPrevented).toBe(true);
    expect(touchMove(grid, 2).defaultPrevented).toBe(false);
    pointer(grid, 'pointerup', { clientX: 220, clientY: 155 });
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(touchMove(grid).defaultPrevented).toBe(false);
    const today = screen.getByRole('button', { name: 'Today' });
    pointer(today, 'pointerdown');
    pointer(today, 'pointerup');
    fireEvent.click(today, { detail: 1 });
    expect(screen.getByRole('button', { pressed: true }).dataset['calendarDate']).toBe(
      '2026-11-07',
    );
    pointer(grid, 'pointerdown', { clientX: 100, clientY: 100 });
    pointer(grid, 'pointermove', { clientX: 102, clientY: 180 });
    expect(touchMove(grid).defaultPrevented).toBe(false);
  });

  it('leaves vertical scrolls, short drags, cancellations, multitouch and mouse selection alone', async () => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    const grid = container.querySelector('[aria-busy]')!;
    for (const kind of ['vertical', 'short', 'cancel', 'multitouch', 'mouse']) {
      const pointerType = kind === 'mouse' ? 'mouse' : 'touch';
      pointer(grid, 'pointerdown', { pointerType, clientX: 100, clientY: 100 });
      if (kind === 'multitouch') pointer(grid, 'pointerdown', { pointerId: 2, isPrimary: false });
      pointer(grid, 'pointermove', {
        pointerType,
        clientX: kind === 'vertical' ? 102 : 130,
        clientY: kind === 'vertical' ? 180 : 102,
      });
      pointer(grid, kind === 'cancel' ? 'pointercancel' : 'pointerup', {
        pointerType,
        clientX: kind === 'short' ? 130 : 230,
        clientY: 105,
      });
      expect(screen.queryByText('November 2026'), kind).not.toBeNull();
    }
  });

  it('reverses the swipe direction in RTL', async () => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    const grid = container.querySelector<HTMLElement>('[aria-busy]')!;
    grid.style.direction = 'rtl';
    pointer(grid, 'pointerdown', { clientX: 80, clientY: 100 });
    pointer(grid, 'pointermove', { clientX: 200, clientY: 102 });
    pointer(grid, 'pointerup', { clientX: 220, clientY: 102 });
    expect(screen.queryByText('November 2026')).not.toBeNull();
  });

  it('turns once per trackpad gesture including momentum, then accepts another gesture', async () => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    const grid = container.querySelector('[aria-busy]')!;
    for (const timeStamp of [1000, 1020, 1040]) wheel(grid, { deltaX: -20, deltaY: 2 }, timeStamp);
    expect(screen.queryByText('October 2026')).not.toBeNull();
    for (const timeStamp of [1060, 1080, 1100]) wheel(grid, { deltaX: -100 }, timeStamp);
    expect(screen.getByText('October 2026')).toBeTruthy();
    wheel(grid, { deltaX: -80 }, 1500);
    expect(screen.getByText('September 2026')).toBeTruthy();
    wheel(grid, { deltaX: 80 }, 1900);
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('preserves vertical scrolling and zoom, and supports Shift+wheel and RTL', async () => {
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    await screen.findByText('No reading activity on this day');
    const grid = container.querySelector<HTMLElement>('[aria-busy]')!;
    expect(wheel(grid, { deltaX: 10, deltaY: 100 }, 1000).defaultPrevented).toBe(false);
    expect(wheel(grid, { deltaX: -100, ctrlKey: true }, 1400).defaultPrevented).toBe(false);
    expect(wheel(grid, { deltaX: -100, metaKey: true }, 1800).defaultPrevented).toBe(false);
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(wheel(grid, { deltaY: -80, shiftKey: true }, 2200).defaultPrevented).toBe(true);
    expect(screen.queryByText('October 2026')).not.toBeNull();
    grid.style.direction = 'rtl';
    wheel(grid, { deltaX: -80 }, 2600);
    expect(screen.getByText('November 2026')).toBeTruthy();
  });

  it('shows all books for a tapped day, including books missing from the local library', async () => {
    query.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => quarter('2026-11-06', `b${i}`, `Book ${i}`)),
    );
    const { container } = render(<ReadingCalendar db={db} daily={daily} />);
    const day = await screen.findByRole('button', { name: /Friday, November 6, 2026.*Book 0/ });
    expect(day.querySelectorAll('[data-cover]')).toHaveLength(3);
    expect(day.textContent).toContain('+2');
    fireEvent.click(day);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByText('Book 4')).toBeTruthy();
    expect(
      container.querySelector('[aria-current="date"]')?.getAttribute('data-calendar-date'),
    ).toBe('2026-11-07');
    expect(screen.getByRole('button', { name: 'Next Month' }).hasAttribute('disabled')).toBe(true);
  });

  it('switches both ways across a year boundary even with no history, without a date picker', async () => {
    vi.setSystemTime(new Date('2026-01-07T12:00:00'));
    render(<ReadingCalendar db={db} daily={new Map()} />);
    await screen.findByText('No reading activity on this day');
    expect(screen.queryByLabelText('Go to date')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith(
        new Date(2025, 11, 1).getTime() / 1000,
        new Date(2026, 0, 1).getTime() / 1000,
      ),
    );
    expect(screen.getByText('December 2025')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next Month' }));
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith(
        new Date(2026, 0, 1).getTime() / 1000,
        new Date(2026, 1, 1).getTime() / 1000,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
      '2026-01-07',
    );
    expect(screen.getByText('January 2026')).toBeTruthy();
  });

  it('supports arrow keys inside a dialog and reverses horizontal movement in RTL', async () => {
    const { container } = render(
      <div ref={(el) => el?.addEventListener('keydown', (event) => event.stopPropagation())}>
        <ReadingCalendar db={db} daily={daily} />
      </div>,
    );
    await screen.findByText('No reading activity on this day');
    const today = container.querySelector<HTMLButtonElement>('[data-calendar-date="2026-11-07"]')!;
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
      '2026-11-06',
    );
    const grid = container.querySelector('[aria-busy]') as HTMLElement;
    grid.style.direction = 'rtl';
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
      '2026-11-05',
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    // Future dates cannot become the roving tab stop.
    expect(screen.getByRole('button', { pressed: true }).getAttribute('data-calendar-date')).toBe(
      '2026-11-05',
    );
  });

  it('ignores a stale month response after switching months', async () => {
    let resolveNovember!: (rows: BookQuarterHourDuration[]) => void;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNovember = resolve;
        }),
    );
    render(<ReadingCalendar db={db} daily={daily} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous Month' }));
    await screen.findByText('No reading activity on this day');
    await act(async () => resolveNovember([quarter('2026-11-07', 'old', 'Stale book')]));
    expect(screen.queryByText('Stale book')).toBeNull();
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('retries a failed query and refreshes after stats sync', async () => {
    query.mockRejectedValueOnce(new Error('busy'));
    const { rerender } = render(<ReadingCalendar db={db} daily={daily} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
    await screen.findByText('No reading activity on this day');
    query.mockResolvedValue([quarter('2026-11-07', 'synced', 'Synced book')]);
    rerender(<ReadingCalendar db={db} daily={new Map(daily)} />);
    expect(await screen.findByText('Synced book')).toBeTruthy();
  });
});
