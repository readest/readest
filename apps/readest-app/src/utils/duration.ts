import type { TranslationFunc } from '@/hooks/useTranslation';

/** "45m", "2h", "1h 36m" - the same units the library shows for book length. */
export const formatDuration = (
  totalMinutes: number,
  _: TranslationFunc,
  formatNumber: (n: number) => string = String,
): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return _('{{minutes}}m', { minutes: formatNumber(minutes) });
  return minutes === 0
    ? _('{{hours}}h', { hours: formatNumber(hours) })
    : _('{{hours}}h {{minutes}}m', { hours: formatNumber(hours), minutes: formatNumber(minutes) });
};

/** "1h 36m left" - the exact duration, for the reading widget. */
export const formatDurationLeft = (totalMinutes: number, _: TranslationFunc): string =>
  _('{{time}} left', { time: formatDuration(totalMinutes, _) });

/** Joins the time and page count into one sentence, so "left" isn't said twice. */
export const formatDurationAndPagesLeft = (
  totalMinutes: number,
  pagesLeft: number,
  _: TranslationFunc,
): string =>
  _('{{time}} and {{count}} pages left', {
    time: formatDuration(totalMinutes, _),
    count: pagesLeft,
  });
