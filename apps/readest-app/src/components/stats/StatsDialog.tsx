'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';
import SegmentedControl from '@/components/SegmentedControl';
import { useReadingStats } from '@/hooks/useReadingStats';
import type { Book } from '@/types/book';
import type { StatsPeriod } from '@/types/statistics';
import { formatReadingDuration, getPeriodRange } from '@/utils/stats';
import DailyBarChart from './DailyBarChart';
import YearHeatmap from './YearHeatmap';
import BookRankingList from './BookRankingList';

export const setStatsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('stats_dialog');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  total: 'Total',
  year: 'Year',
  month: 'Month',
  week: 'Week',
};

interface StatsDialogProps {
  /** Opens the book details dialog for a library book tapped in the ranking. */
  onShowBookDetails?: (book: Book) => void;
}

const StatsDialog: React.FC<StatsDialogProps> = ({ onShowBookDetails }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isOpen, setIsOpen] = useState(false);
  const [period, setPeriod] = useState<StatsPeriod>('month');

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };
    const el = document.getElementById('stats_dialog');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }
    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const handleClose = useCallback(() => setIsOpen(false), []);

  const { loading, totals, periodSeconds, daily, ranking } = useReadingStats(isOpen, period);

  const periodOptions = useMemo(
    () =>
      (Object.keys(PERIOD_LABELS) as StatsPeriod[]).map((value) => ({
        value,
        label: _(PERIOD_LABELS[value]),
      })),
    [_],
  );

  const range = useMemo(() => getPeriodRange(period), [period]);
  const hasAnyData = !!totals && totals.totalSeconds > 0;

  return (
    <Dialog
      id='stats_dialog'
      isOpen={isOpen}
      title={_('Reading Time')}
      onClose={handleClose}
      snapHeight={appService?.isMobile ? 0.85 : undefined}
      boxClassName='sm:w-[560px]! sm:max-w-(--breakpoint-md)! sm:h-[80vh]!'
      useOverlayScroll
    >
      {isOpen && (
        <div className='flex flex-col gap-5 pb-6'>
          <SegmentedControl
            options={periodOptions}
            value={period}
            onChange={setPeriod}
            ariaLabel={_('Time Range')}
            fullWidth
          />
          {loading ? (
            <div className='flex justify-center py-12'>
              <span className='not-eink:loading-dots eink:loading-spinner loading loading-md' />
            </div>
          ) : !hasAnyData ? (
            <div className='text-neutral-content py-12 text-center text-sm'>
              {_('No reading history yet')}
              <p className='text-neutral-content/60 mt-2 text-xs'>
                {_(
                  'Reading time is recorded automatically while you read, starting from the version that added tracking.',
                )}
              </p>
            </div>
          ) : (
            <>
              {period === 'total' && totals ? (
                <div className='flex flex-col items-center gap-1 py-2'>
                  <span className='text-3xl font-bold tabular-nums'>
                    {formatReadingDuration(totals.totalSeconds, _)}
                  </span>
                  <span className='text-neutral-content text-xs'>
                    {_('{{days}} days read · {{avg}} per day on average', {
                      days: totals.readDays,
                      avg: formatReadingDuration(
                        Math.round(totals.totalSeconds / Math.max(1, totals.readDays)),
                        _,
                      ),
                    })}
                  </span>
                </div>
              ) : (
                <div className='flex flex-col items-center gap-1 py-2'>
                  <span className='text-3xl font-bold tabular-nums'>
                    {formatReadingDuration(periodSeconds, _)}
                  </span>
                </div>
              )}

              {period === 'year' ? (
                <YearHeatmap daily={daily} year={dayjs().year()} />
              ) : period === 'total' ? null : (
                <DailyBarChart
                  daily={daily}
                  fromTs={range.fromTs}
                  toTs={range.toTs}
                  variant={period === 'week' ? 'week' : 'month'}
                />
              )}

              <div className='flex flex-col gap-2'>
                <h3 className='text-neutral-content/85 text-sm font-semibold'>
                  {_('Reading Ranking')}
                </h3>
                <BookRankingList
                  ranking={ranking}
                  totalSeconds={period === 'total' ? (totals?.totalSeconds ?? 0) : periodSeconds}
                  onShowBookDetails={onShowBookDetails}
                />
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};

export default StatsDialog;
