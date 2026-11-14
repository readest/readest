import React, { useEffect, useRef, useState } from 'react';
import { MdCalendarMonth } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { getDailySeconds, getStreaks, toDateKey } from '@/services/statistics/readingStats';
import { BoxedList, NavigationRow, SettingsRow } from '@/components/settings/primitives';
import SubPageHeader from '@/components/settings/SubPageHeader';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import ReadingTimeChart from './ReadingTimeChart';
import ReadingHeatmap from './ReadingHeatmap';
import ReadingCalendar from './ReadingCalendar';

export const setReadingStatsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('reading_stats_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

interface ReadingStats {
  db: StatisticsDb;
  daily: Map<string, number>;
  totals: { seconds: number; books: number; pages: number };
}

interface ReadingStatsContentProps {
  showCalendar: boolean;
  onShowCalendar: (visible: boolean) => void;
}

const ReadingStatsContent: React.FC<ReadingStatsContentProps> = ({
  showCalendar,
  onShowCalendar,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [failed, setFailed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const shownCalendar = useRef(showCalendar);

  // Move focus only on navigation, not when the dialog first renders.
  useEffect(() => {
    if (shownCalendar.current === showCalendar) return;
    shownCalendar.current = showCalendar;
    const target = contentRef.current?.querySelector<HTMLElement>(
      showCalendar ? '[data-calendar-heading]' : '[data-setting-id="stats.readingCalendar"]',
    );
    target?.focus();
    if (showCalendar) target?.scrollIntoView?.({ block: 'start' });
  }, [showCalendar]);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    const load = async (db: StatisticsDb) => {
      const [quarters, totals] = await Promise.all([
        db.getQuarterHourDurations(),
        db.getReadingTotals(),
      ]);
      if (!cancelled) setStats({ db, daily: getDailySeconds(quarters), totals });
    };
    StatisticsDb.open(appService)
      .then(async (db) => {
        await load(db);
        // Only an open book pulls stats, so from the library this device may
        // not have the account's other devices yet: show what's here, then pull.
        if (user && isSyncCategoryEnabled('stats')) {
          // Loaded here so the menus that import this dialog don't pull the
          // sync client (and its API base URL) into their module graph.
          const [{ SyncClient }, { pullStats }] = await Promise.all([
            import('@/libs/sync'),
            import('@/services/statistics/statsSync'),
          ]);
          await pullStats(db, new SyncClient()).catch((err) =>
            console.warn('Failed to pull reading stats:', err),
          );
          await load(db);
        }
      })
      .catch((err) => {
        console.error('Failed to load reading stats:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appService, user]);

  if (failed) {
    return (
      <p className='text-base-content/70 py-10 text-center'>
        {_('Failed to load reading statistics')}
      </p>
    );
  }
  if (!stats) return null;

  const { daily, totals } = stats;
  const streaks = getStreaks(daily);
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);
  const days = (count: number) => _('{{count}} days', { count });

  if (showCalendar) {
    return (
      <div ref={contentRef} className='pb-6'>
        <div tabIndex={-1} data-calendar-heading className='outline-hidden'>
          <SubPageHeader
            parentLabel={_('Reading Statistics')}
            currentLabel={_('Reading Calendar')}
            description={_('See which books you read each day and for how long')}
            onBack={() => onShowCalendar(false)}
          />
        </div>
        <BoxedList innerClassName='px-2! py-3'>
          <ReadingCalendar db={stats.db} daily={daily} />
        </BoxedList>
      </div>
    );
  }

  return (
    <div ref={contentRef} className='flex flex-col gap-6 pb-6'>
      <BoxedList title={_('Reading Time')} innerClassName='pe-4 py-4'>
        <ReadingTimeChart daily={daily} />
      </BoxedList>
      <BoxedList title={_('Activity')} innerClassName='pe-4 pt-4'>
        <div className='pb-4'>
          <ReadingHeatmap daily={daily} />
        </div>
        <NavigationRow
          title={_('Reading Calendar')}
          icon={MdCalendarMonth}
          onClick={() => onShowCalendar(true)}
          data-setting-id='stats.readingCalendar'
          className='pe-0 text-start'
        />
      </BoxedList>
      <BoxedList title={_('Overview')}>
        <SettingsRow label={_('Today')}>
          <span className='tabular-nums'>{time(daily.get(toDateKey(new Date())) ?? 0)}</span>
        </SettingsRow>
        <SettingsRow label={_('Current Streak')}>
          <span className='tabular-nums'>{days(streaks.current)}</span>
        </SettingsRow>
        <SettingsRow label={_('Longest Streak')}>
          <span className='tabular-nums'>{days(streaks.longest)}</span>
        </SettingsRow>
      </BoxedList>
      <BoxedList title={_('All Time')}>
        <SettingsRow label={_('Reading Time')}>
          <span className='tabular-nums'>{time(totals.seconds)}</span>
        </SettingsRow>
        <SettingsRow label={_('Books')}>
          <span className='tabular-nums'>{totals.books.toLocaleString(getLocale())}</span>
        </SettingsRow>
        <SettingsRow label={_('Pages')}>
          <span className='tabular-nums'>{totals.pages.toLocaleString(getLocale())}</span>
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export const ReadingStatsDialog: React.FC = () => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      setShowCalendar(false);
    };

    const el = document.getElementById('reading_stats_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='reading_stats_window'
      isOpen={isOpen}
      title={_('Reading Statistics')}
      onClose={() => setIsOpen(false)}
      onBack={showCalendar ? () => setShowCalendar(false) : undefined}
      useOverlayScroll
      boxClassName='sm:h-[85%]! sm:w-[560px]! sm:max-w-(--breakpoint-sm)!'
      contentClassName='px-4! sm:px-6!'
    >
      {isOpen && (
        <ReadingStatsContent showCalendar={showCalendar} onShowCalendar={setShowCalendar} />
      )}
    </Dialog>
  );
};

export default ReadingStatsDialog;
