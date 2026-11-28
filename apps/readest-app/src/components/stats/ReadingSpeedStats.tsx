import React from 'react';
import { MdChevronRight } from 'react-icons/md';
import { BoxedList, SettingsRow, SettingsSelect } from '@/components/settings/primitives';
import SectionTitle from '@/components/settings/primitives/SectionTitle';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getDailySpeeds,
  getMonthlySpeeds,
  getSpeedChange,
  getSpeedKey,
  sumSpeeds,
  toPace,
  type BookReadingSpeed,
  type ReadingSpeedQuarter,
  type SpeedLanguage,
} from '@/services/statistics/readingSpeedStats';
import { shiftPeriod, toDateKey } from '@/services/statistics/readingStats';
import { getLocale } from '@/utils/misc';
import ReadingSpeedChart from './ReadingSpeedChart';
import { formatPace, formatUnit } from './formatReadingSpeed';

/** Weeks the trend beside each language covers. */
const TREND_WEEKS = 12;

export const getLanguageName = (lang: string, _: TranslationFunc) => {
  if (!lang) return _('Unknown');
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
};

const formatChange = (change: number, locale: string) =>
  change.toLocaleString(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });

/** Each week keeps its place, so weeks without a speed show as a gap in time. */
const Sparkline: React.FC<{ paces: (number | null)[] }> = ({ paces }) => {
  const measured = paces.filter((pace) => pace !== null);
  const low = Math.min(...measured);
  const spread = Math.max(...measured) - low || 1;
  const points = paces
    .flatMap((pace, i) =>
      pace === null
        ? []
        : [`${(i / (paces.length - 1)) * 100},${90 - ((pace - low) / spread) * 80}`],
    )
    .join(' ');
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      className='h-7 w-14 shrink-0 overflow-visible rtl:-scale-x-100'
    >
      <polyline
        points={points}
        fill='none'
        strokeWidth={1.5}
        strokeLinejoin='round'
        vectorEffect='non-scaling-stroke'
        className='stroke-base-content/80'
      />
    </svg>
  );
};

interface ReadingSpeedSectionProps {
  languages: SpeedLanguage[];
  quarters: ReadingSpeedQuarter[];
  onOpen: (key: string) => void;
  'data-setting-id'?: string;
}

/** Each language's average speed, its change this month and its recent trend. */
export const ReadingSpeedSection: React.FC<ReadingSpeedSectionProps> = ({
  languages,
  quarters,
  onOpen,
  'data-setting-id': dataSettingId,
}) => {
  const _ = useTranslation();
  const locale = getLocale();
  const today = new Date();
  const month = shiftPeriod('month', today, 0);
  const week = shiftPeriod('week', today, 0);

  return (
    <div className='w-full'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <SectionTitle>{_('Reading Speed')}</SectionTitle>
        <button
          type='button'
          data-setting-id={dataSettingId}
          className='touch-target text-base-content/70 hover:text-base-content flex items-center text-[0.8em] focus-visible:underline focus-visible:outline-hidden'
          onClick={() => onOpen(languages[0]!.key)}
        >
          {_('Details')}
          <MdChevronRight aria-hidden='true' className='h-4 w-4 rtl:rotate-180' />
        </button>
      </div>
      <BoxedList>
        {languages.map(({ key, lang, unit, total }) => {
          const daily = getDailySpeeds(quarters, key);
          const change = getSpeedChange(
            sumSpeeds(daily, month, shiftPeriod('month', month, 1)),
            sumSpeeds(daily, shiftPeriod('month', month, -1), month),
          );
          const trend = Array.from({ length: TREND_WEEKS }, (_, i) => {
            const start = shiftPeriod('week', week, i - TREND_WEEKS + 1);
            return toPace(sumSpeeds(daily, start, shiftPeriod('week', start, 1)));
          });
          return (
            <button
              key={key}
              type='button'
              className='focus-visible:ring-base-content/15 flex min-h-14 w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 py-1.5 pe-4 text-start focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset'
              onClick={() => onOpen(key)}
            >
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate font-medium'>{getLanguageName(lang, _)}</span>
                {change !== null && (
                  <span className='text-base-content/70 text-[0.8em]'>
                    {_('{{change}} this month', { change: formatChange(change, locale) })}
                  </span>
                )}
              </span>
              <span className='flex shrink-0 items-center gap-3'>
                <span className='flex flex-col items-end leading-tight'>
                  <span className='font-medium tabular-nums'>
                    {Math.round(toPace(total)!).toLocaleString(locale)}
                  </span>{' '}
                  <span className='text-base-content/70 text-[0.8em]'>{formatUnit(unit, _)}</span>
                </span>
                {trend.filter((pace) => pace !== null).length > 1 && <Sparkline paces={trend} />}
              </span>
            </button>
          );
        })}
      </BoxedList>
    </div>
  );
};

interface ReadingSpeedPageProps {
  languages: SpeedLanguage[];
  quarters: ReadingSpeedQuarter[];
  books: BookReadingSpeed[];
  selected: string;
  onSelect: (key: string) => void;
}

/** One language's speed over time, its best month, and each book read in it. */
export const ReadingSpeedPage: React.FC<ReadingSpeedPageProps> = ({
  languages,
  quarters,
  books,
  selected,
  onSelect,
}) => {
  const _ = useTranslation();
  const locale = getLocale();
  const language = languages.find(({ key }) => key === selected) ?? languages[0];
  if (!language) {
    return (
      <p className='text-base-content/70 py-10 text-center'>{_('No reading speed measured')}</p>
    );
  }
  const { key, unit } = language;
  const daily = getDailySpeeds(quarters, key);
  const today = new Date();
  const pace = (value: number | null) =>
    value === null ? '—' : formatPace(value, unit, locale, _);
  const current = (range: 'week' | 'month') =>
    pace(toPace(sumSpeeds(daily, shiftPeriod(range, today, 0), shiftPeriod(range, today, 1))));
  const monthly = [...getMonthlySpeeds(daily).values()].map((speed) => toPace(speed)!);

  return (
    <div className='flex flex-col gap-6'>
      <BoxedList>
        <SettingsRow label={_('Language')}>
          <SettingsSelect
            value={key}
            ariaLabel={_('Language')}
            onChange={(e) => onSelect(e.target.value)}
            options={languages.map((l) => ({
              value: l.key,
              // Speeds recorded before languages were can be in either unit.
              label: l.lang
                ? getLanguageName(l.lang, _)
                : `${_('Unknown')} · ${formatUnit(l.unit, _)}`,
            }))}
          />
        </SettingsRow>
      </BoxedList>
      <BoxedList innerClassName='pe-4 py-4'>
        <ReadingSpeedChart key={key} daily={daily} unit={unit} />
      </BoxedList>
      <BoxedList title={_('Overview')}>
        <SettingsRow label={_('Today')}>
          <span className='text-end tabular-nums'>{pace(toPace(daily.get(toDateKey(today))))}</span>
        </SettingsRow>
        <SettingsRow label={_('This Week')}>
          <span className='text-end tabular-nums'>{current('week')}</span>
        </SettingsRow>
        <SettingsRow label={_('This Month')}>
          <span className='text-end tabular-nums'>{current('month')}</span>
        </SettingsRow>
        <SettingsRow label={_('Highest Monthly Average')} className='flex-wrap py-3'>
          <span className='ms-auto text-end tabular-nums'>
            {pace(monthly.length ? Math.max(...monthly) : null)}
          </span>
        </SettingsRow>
      </BoxedList>
      <BoxedList title={_('Reading Speed by Book')}>
        {books
          .filter((book) => getSpeedKey(book) === key)
          .map((book) => (
            <SettingsRow key={book.md5} label={book.title} description={book.authors}>
              <span className='shrink-0 whitespace-nowrap text-end tabular-nums'>
                {pace(toPace(book))}
              </span>
            </SettingsRow>
          ))}
      </BoxedList>
    </div>
  );
};
