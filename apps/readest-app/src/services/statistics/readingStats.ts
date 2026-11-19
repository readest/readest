/** Minimum reading in a day for it to count toward a streak. */
const MIN_STREAK_SECONDS = 60;

export type ReadingRange = 'week' | 'month' | 'year';

export interface ReadingBar {
  /** Local day or month this bar covers. */
  date: Date;
  seconds: number;
}

/** 'YYYY-MM-DD' for a local date. */
export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** Folds quarter-hour totals into seconds read on each local day. */
export const getDailySeconds = (
  quarters: { quarter: number; seconds: number }[],
): Map<string, number> => {
  const daily = new Map<string, number>();
  for (const { quarter, seconds } of quarters) {
    const key = toDateKey(new Date(quarter * 900 * 1000));
    daily.set(key, (daily.get(key) ?? 0) + seconds);
  }
  return daily;
};

export type BookReading = {
  bookMd5: string;
  title: string;
  authors: string;
  seconds: number;
};

export type BookQuarterHourDuration = BookReading & { quarter: number };

/** Keep book identity while folding the same quarter-hour buckets as the charts. */
export const getDailyBookReadings = (
  quarters: BookQuarterHourDuration[],
): Map<string, BookReading[]> => {
  const days = new Map<string, Map<string, BookReading>>();
  for (const { quarter, ...reading } of quarters) {
    if (reading.seconds <= 0) continue;
    const key = toDateKey(new Date(quarter * 900 * 1000));
    const books = days.get(key) ?? new Map<string, BookReading>();
    const previous = books.get(reading.bookMd5);
    books.set(reading.bookMd5, {
      ...reading,
      seconds: (previous?.seconds ?? 0) + reading.seconds,
    });
    days.set(key, books);
  }
  return new Map(
    [...days].map(([key, books]) => [
      key,
      [...books.values()].sort(
        (a, b) => b.seconds - a.seconds || a.bookMd5.localeCompare(b.bookMd5),
      ),
    ]),
  );
};

/** Sunday-first month like the heatmap, padded to complete weeks; dates stay in local time. */
export const getCalendarDays = (month: Date): (Date | null)[] => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, index) =>
    index < offset || index >= offset + length
      ? null
      : new Date(month.getFullYear(), month.getMonth(), index - offset + 1),
  );
};

/** The current streak runs to today, or to yesterday until today counts. */
export const getStreaks = (daily: Map<string, number>, today = new Date()) => {
  const isReadingDay = (date: Date) => (daily.get(toDateKey(date)) ?? 0) >= MIN_STREAK_SECONDS;
  let current = 0;
  for (let day = isReadingDay(today) ? today : addDays(today, -1); isReadingDay(day); ) {
    current++;
    day = addDays(day, -1);
  }

  let longest = 0;
  let run = 0;
  let previous = '';
  const days = [...daily.keys()].filter((key) => daily.get(key)! >= MIN_STREAK_SECONDS).sort();
  for (const key of days) {
    run = previous && toDateKey(addDays(new Date(`${previous}T00:00:00`), 1)) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  return { current, longest };
};

/** Start of the calendar week (Sunday-first, like the heatmap), month or year `delta` periods from the one holding `date`. */
export const shiftPeriod = (range: ReadingRange, date: Date, delta: number): Date => {
  const year = date.getFullYear();
  if (range === 'year') return new Date(year + delta, 0, 1);
  if (range === 'month') return new Date(year, date.getMonth() + delta, 1);
  return new Date(year, date.getMonth(), date.getDate() - date.getDay() + 7 * delta);
};

/** Bars for each day of the calendar week or month holding `date`, or for each month of its year. */
export const getReadingBars = (
  daily: Map<string, number>,
  range: ReadingRange,
  date = new Date(),
): ReadingBar[] => {
  const start = shiftPeriod(range, date, 0);
  if (range === 'year') {
    return Array.from({ length: 12 }, (_, i) => {
      const month = new Date(start.getFullYear(), i, 1);
      const prefix = toDateKey(month).slice(0, 8);
      let seconds = 0;
      for (const [key, value] of daily) {
        if (key.startsWith(prefix)) seconds += value;
      }
      return { date: month, seconds };
    });
  }
  const end = shiftPeriod(range, start, 1);
  const bars: ReadingBar[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) {
    bars.push({ date: day, seconds: daily.get(toDateKey(day)) ?? 0 });
  }
  return bars;
};
