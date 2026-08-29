import dayjs from 'dayjs';
import type { StatsPeriod } from '@/types/statistics';

/**
 * Local-timezone [fromTs, toTs) window in Unix seconds for a stats period.
 * The exclusive `toTs` is local midnight of tomorrow so a session started
 * today is included through the end of the day.
 */
export const getPeriodRange = (period: StatsPeriod): { fromTs: number; toTs: number } => {
  const now = dayjs();
  const toTs = now.add(1, 'day').startOf('day').valueOf();
  switch (period) {
    case 'week':
      // Monday-start week without pulling in the isoWeek plugin:
      // day() is 0 (Sun) .. 6 (Sat), so offset back to Monday.
      return {
        fromTs: now
          .subtract((now.day() + 6) % 7, 'day')
          .startOf('day')
          .valueOf(),
        toTs,
      };
    case 'month':
      return { fromTs: now.startOf('month').valueOf(), toTs };
    case 'year':
      return { fromTs: now.startOf('year').valueOf(), toTs };
    case 'total':
      return { fromTs: 0, toTs };
  }
};

/** Seconds east of UTC; the sign convention SQL day-bucketing expects. */
export const getTzOffsetSecs = (): number => -new Date().getTimezoneOffset() * 60;

/**
 * "2 hr 30 min" / "45 min" / "2 hr" / "Less than a minute", localized through
 * i18next interpolation. `t` is the `useTranslation` function passed in so
 * this stays usable outside components.
 */
export const formatReadingDuration = (
  seconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 1) return t('Less than a minute');
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return t('{{minutes}} min', { minutes });
  if (minutes === 0) return t('{{hours}} hr', { hours });
  return t('{{hours}} hr {{minutes}} min', { hours, minutes });
};
