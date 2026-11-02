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

/** Bars for the last 7 or 30 days, or for the last 12 months. */
export const getReadingBars = (
  daily: Map<string, number>,
  range: ReadingRange,
  today = new Date(),
): ReadingBar[] => {
  if (range === 'year') {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      const prefix = toDateKey(date).slice(0, 8);
      let seconds = 0;
      for (const [key, value] of daily) {
        if (key.startsWith(prefix)) seconds += value;
      }
      return { date, seconds };
    });
  }
  const length = range === 'week' ? 7 : 30;
  return Array.from({ length }, (_, i) => {
    const date = addDays(today, i - length + 1);
    return { date, seconds: daily.get(toDateKey(date)) ?? 0 };
  });
};
