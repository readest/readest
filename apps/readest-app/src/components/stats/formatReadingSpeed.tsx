import type { TranslationFunc } from '@/hooks/useTranslation';
import type { ReadingSpeed, ReadingSpeedUnit } from '@/types/statistics';

/** The unit alone, for a speed set apart from it. */
export const formatUnit = (unit: ReadingSpeedUnit, _: TranslationFunc) =>
  unit === 'characters' ? _('characters/min') : _('words/min');

/** One speed with its unit, e.g. "250 words/min". */
export const formatPace = (
  pace: number,
  unit: ReadingSpeedUnit,
  locale: string,
  _: TranslationFunc,
) => {
  const speed = Math.round(pace).toLocaleString(locale);
  return unit === 'characters'
    ? _('{{speed}} characters/min', { speed })
    : _('{{speed}} words/min', { speed });
};

/** Each unit's speed as a localized list that breaks between units, never inside one. */
export const formatReadingSpeed = (speeds: ReadingSpeed[], locale: string, _: TranslationFunc) => {
  const labels = speeds
    .filter(({ count, durationMs }) => count > 0 && durationMs > 0)
    .sort((a, b) => a.unit.localeCompare(b.unit))
    .map(({ unit, count, durationMs }) =>
      formatPace((count * 60_000) / durationMs, unit, locale, _),
    );
  if (!labels.length) return null;
  return new Intl.ListFormat(locale, { type: 'unit' })
    .formatToParts(labels)
    .map(({ type, value }, i) =>
      type === 'element' ? (
        <span key={i} className='whitespace-nowrap'>
          {value}
        </span>
      ) : (
        value
      ),
    );
};
