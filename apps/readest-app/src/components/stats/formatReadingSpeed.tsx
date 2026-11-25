import type { TranslationFunc } from '@/hooks/useTranslation';
import type { ReadingSpeed } from '@/types/statistics';

export const formatReadingSpeed = (speeds: ReadingSpeed[], locale: string, _: TranslationFunc) => {
  const labels = speeds
    .filter(({ count, durationMs }) => count > 0 && durationMs > 0)
    .sort((a, b) => a.unit.localeCompare(b.unit))
    .map(({ unit, count, durationMs }) => {
      const speed = Math.round((count * 60_000) / durationMs).toLocaleString(locale);
      return unit === 'characters'
        ? _('{{speed}} characters/min', { speed })
        : _('{{speed}} words/min', { speed });
    });
  return new Intl.ListFormat(locale, { type: 'unit' }).format(labels);
};
