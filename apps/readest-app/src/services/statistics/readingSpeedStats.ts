import type { ReadingSpeed, ReadingSpeedUnit } from '@/types/statistics';
import { shiftPeriod, toDateKey, type ReadingRange } from './readingStats';

/** Speed measured in one quarter hour (Unix ms / 900000), in one language. */
export type ReadingSpeedQuarter = ReadingSpeed & { quarter: number; lang: string };

export type BookReadingSpeed = ReadingSpeed & {
  md5: string;
  title: string;
  authors: string;
  lang: string;
  lastRead: number; // Unix ms
};

/** A language read, in the unit it is counted in. `lang` is '' when the book didn't say. */
export type SpeedLanguage = {
  key: string;
  lang: string;
  unit: ReadingSpeedUnit;
  total: ReadingSpeed;
};

export type SpeedPoint = { date: Date; speed: ReadingSpeed | null };

/** A language without a code is still counted in one unit: keep each unit apart. */
export const getSpeedKey = ({ lang, unit }: { lang: string; unit: ReadingSpeedUnit }) =>
  `${lang}:${unit}`;

/** Words or characters per minute. */
export const toPace = (speed: ReadingSpeed | null | undefined): number | null =>
  speed && speed.durationMs > 0 ? (speed.count * 60_000) / speed.durationMs : null;

/** How much faster `current` is than `previous`, as a fraction. */
export const getSpeedChange = (
  current: ReadingSpeed | null,
  previous: ReadingSpeed | null,
): number | null => {
  const now = toPace(current);
  const before = toPace(previous);
  return now !== null && before ? now / before - 1 : null;
};

const add = (total: ReadingSpeed | null | undefined, speed: ReadingSpeed): ReadingSpeed => ({
  unit: speed.unit,
  count: (total?.count ?? 0) + speed.count,
  durationMs: (total?.durationMs ?? 0) + speed.durationMs,
});

/** Languages read, most measured reading first. */
export const getSpeedLanguages = (quarters: ReadingSpeedQuarter[]): SpeedLanguage[] => {
  const languages = new Map<string, SpeedLanguage>();
  for (const { lang, unit, count, durationMs } of quarters) {
    const key = getSpeedKey({ lang, unit });
    const language = languages.get(key);
    languages.set(key, {
      key,
      lang,
      unit,
      total: add(language?.total, { unit, count, durationMs }),
    });
  }
  return [...languages.values()].sort(
    (a, b) => b.total.durationMs - a.total.durationMs || a.key.localeCompare(b.key),
  );
};

/** One language's speed on each local day it was measured. */
export const getDailySpeeds = (
  quarters: ReadingSpeedQuarter[],
  key: string,
): Map<string, ReadingSpeed> => {
  const daily = new Map<string, ReadingSpeed>();
  for (const { quarter, lang, unit, count, durationMs } of quarters) {
    if (getSpeedKey({ lang, unit }) !== key) continue;
    const day = toDateKey(new Date(quarter * 900_000));
    daily.set(day, add(daily.get(day), { unit, count, durationMs }));
  }
  return daily;
};

/** Total speed over the local days from `start` up to, not including, `end`. */
export const sumSpeeds = (
  daily: Map<string, ReadingSpeed>,
  start: Date,
  end: Date,
): ReadingSpeed | null => {
  const from = toDateKey(start);
  const to = toDateKey(end);
  let total: ReadingSpeed | null = null;
  for (const [day, speed] of daily) {
    if (day >= from && day < to) total = add(total, speed);
  }
  return total;
};

/** Speed on each month ('YYYY-MM') measured, oldest first. */
export const getMonthlySpeeds = (daily: Map<string, ReadingSpeed>): Map<string, ReadingSpeed> => {
  const monthly = new Map<string, ReadingSpeed>();
  for (const day of [...daily.keys()].sort()) {
    const month = day.slice(0, 7);
    monthly.set(month, add(monthly.get(month), daily.get(day)!));
  }
  return monthly;
};

/** Speed on each day of the week or month holding `date`, or in each month of its year. */
export const getSpeedPoints = (
  daily: Map<string, ReadingSpeed>,
  range: ReadingRange,
  date: Date,
): SpeedPoint[] => {
  const start = shiftPeriod(range, date, 0);
  const end = shiftPeriod(range, start, 1);
  const points: SpeedPoint[] = [];
  for (let day = start; day < end; ) {
    const next =
      range === 'year'
        ? new Date(day.getFullYear(), day.getMonth() + 1, 1)
        : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    points.push({ date: day, speed: sumSpeeds(daily, day, next) });
    day = next;
  }
  return points;
};
