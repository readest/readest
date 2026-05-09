import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatNumber, formatProgress } from '@/utils/progress';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { SIZE_PER_LOC, SIZE_PER_TIME_UNIT } from '@/services/constants';
import type { ProgressBarMode } from '@/types/book.ts';
import StatusInfo from './StatusInfo.tsx';

interface ProgressBarProps {
  bookKey: string;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  bookKey,
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getProgress, getViewSettings, getView } = useReaderStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const progress = getProgress(bookKey);
  const { section, pageinfo } = progress || {};

  const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
  const isScrolled = viewSettings.scrolled;
  const isVertical = viewSettings.vertical;
  const isEink = viewSettings.isEink;
  const { progressStyle: readingProgressStyle } = viewSettings;

  const template =
    readingProgressStyle === 'fraction'
      ? isVertical
        ? '{current} · {total}'
        : '{current} / {total}'
      : '{percent}%';

  const lang = localStorage?.getItem('i18nextLng') || '';
  const localize = isVertical && lang.toLowerCase().startsWith('zh');
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const progressInfo = formatProgress(pageInfo?.current, pageInfo?.total, template, localize, lang);

  const { page: current = 0, pages: total = 0 } = view?.renderer || {};
  const pagesLeft = bookData?.isFixedLayout
    ? 1
    : Math.min(Math.max(total - current, 1), pageInfo ? pageInfo.total - pageInfo.current : total);
  const showPagesLeft = total > 0 || bookData?.isFixedLayout;
  const timeLeftStr = showPagesLeft
    ? _('{{time}} min left in chapter', {
        time: formatNumber(
          Math.round((pagesLeft * SIZE_PER_LOC) / SIZE_PER_TIME_UNIT),
          localize,
          lang,
        ),
      })
    : '';
  const pagesLeftStr = showPagesLeft
    ? localize
      ? _('{{number}} pages left in chapter', {
          number: formatNumber(pagesLeft, localize, lang),
        })
      : _('{{count}} pages left in chapter', {
          count: pagesLeft,
        })
    : '';

  const [progressBarMode, setProgressBarMode] = useState<string>(viewSettings.progressInfoMode);

  const hasRemainingInfo = viewSettings.showRemainingTime || viewSettings.showRemainingPages;
  const hasProgressInfo = viewSettings.showProgressInfo;
  const hasTimeInfo = viewSettings.showCurrentTime;
  const hasBatteryInfo = viewSettings.showCurrentBatteryStatus;
  const cycleProgressInfoModes = () => {
    if (!viewSettings.tapToToggleFooter) return;

    const modeSequence: string[] = [
      'all',
      `${hasRemainingInfo ? 'remaining+' : ''}${hasProgressInfo ? 'progress' : ''}`,
      `${hasRemainingInfo ? 'remaining' : ''}`,
      `${hasProgressInfo ? 'progress' : ''}`,
      `${hasBatteryInfo ? 'battery+' : ''}${hasTimeInfo ? 'time' : ''}`,
      `${hasBatteryInfo ? 'battery' : ''}`,
      `${hasTimeInfo ? 'time' : ''}`,
      'none',
    ]
      .map((mode) => mode.replace(/^\+|\+$/g, ''))
      .filter((mode) => mode !== '')
      .filter((mode, index, self) => self.indexOf(mode) === index);

    const currentMode = progressBarMode;
    const currentIndex = modeSequence.indexOf(currentMode);
    for (let i = 1; i <= modeSequence.length; i++) {
      const nextIndex = (currentIndex + i) % modeSequence.length;
      const nextMode = modeSequence[nextIndex]!;

      const currentRenders = {
        remaining:
          currentMode === 'all' || currentMode.includes('remaining') ? hasRemainingInfo : false,
        progress:
          currentMode === 'all' || currentMode.includes('progress') ? hasProgressInfo : false,
        battery: currentMode === 'all' || currentMode.includes('battery') ? hasBatteryInfo : false,
        time: currentMode === 'all' || currentMode.includes('time') ? hasTimeInfo : false,
        none: currentMode === 'none',
      };

      const nextRenders = {
        remaining: nextMode === 'all' || nextMode.includes('remaining') ? hasRemainingInfo : false,
        progress: nextMode === 'all' || nextMode.includes('progress') ? hasProgressInfo : false,
        battery: nextMode === 'all' || nextMode.includes('battery') ? hasBatteryInfo : false,
        time: nextMode === 'all' || nextMode.includes('time') ? hasTimeInfo : false,
        none: nextMode === 'none',
      };

      const isDifferent =
        currentRenders.remaining !== nextRenders.remaining ||
        currentRenders.progress !== nextRenders.progress ||
        currentRenders.battery !== nextRenders.battery ||
        currentRenders.time !== nextRenders.time ||
        currentRenders.none !== nextRenders.none;
      if (isDifferent) {
        setProgressBarMode(nextMode);
        return;
      }
    }

    const nextIndex = (currentIndex + 1) % modeSequence.length;
    setProgressBarMode(modeSequence[nextIndex]!);
  };

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'progressInfoMode', progressBarMode as ProgressBarMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressBarMode]);

  // Self-heal a stuck "none" (or partial) mode left over from a prior
  // tap-to-toggle session. Without this, dismissing the footer via tap
  // and then disabling the toggle in settings would leave the footer
  // permanently hidden — the user's only way back to a visible footer
  // would be to re-enable the toggle and tap through the cycle.
  useEffect(() => {
    if (!viewSettings.tapToToggleFooter && progressBarMode !== 'all') {
      setProgressBarMode('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings.tapToToggleFooter]);

  const isMobile = appService?.isMobile || window.innerWidth < 640;
  const showStatusInfo =
    (progressBarMode === 'all' ||
      progressBarMode.includes('battery') ||
      progressBarMode.includes('time')) &&
    (hasTimeInfo || hasBatteryInfo);

  return (
    <div
      role='presentation'
      tabIndex={-1}
      className={clsx(
        'progressinfo absolute bottom-0 flex items-center justify-between font-sans',
        isEink ? 'text-sm font-normal' : 'text-neutral-content text-xs font-extralight',
        isVertical ? 'writing-vertical-rl' : 'w-full',
        isScrolled && !isVertical && 'bg-base-100',
        isMobile ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      onClick={() => {
        if (eventDispatcher.dispatchSync('iframe-single-click')) return;
        cycleProgressInfoModes();
      }}
      aria-label={[
        progress
          ? _('On {{current}} of {{total}} page', {
              current: current + 1,
              total: total,
            })
          : '',
        timeLeftStr,
        pagesLeftStr,
      ]
        .filter(Boolean)
        .join(', ')}
      style={
        isVertical
          ? {
              top: `${(contentInsets.top - gridInsets.top) * 1.5}px`,
              bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
              left: showDoubleBorder
                ? `calc(${contentInsets.left}px)`
                : `calc(${Math.max(0, contentInsets.left - 32)}px)`,
              width: showDoubleBorder ? '32px' : `${contentInsets.left}px`,
            }
          : {
              paddingInlineStart: `calc(${horizontalGap / 2}% + ${contentInsets.left / 2}px)`,
              paddingInlineEnd: `calc(${horizontalGap / 2}% + ${contentInsets.right / 2}px)`,
              paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
            }
      }
    >
      <div
        aria-hidden='true'
        className={clsx(
          'flex items-center justify-between',
          isVertical ? 'h-full' : 'h-[52px] w-full',
        )}
      >
        {(progressBarMode === 'all' || progressBarMode.includes('remaining')) &&
          hasRemainingInfo && (
            <div
              className={clsx(
                'remaining-info flex-1 whitespace-nowrap text-start',
                showStatusInfo && 'overflow-hidden',
              )}
            >
              {viewSettings.showRemainingTime ? (
                <span className='time-left-label text-start'>{timeLeftStr}</span>
              ) : viewSettings.showRemainingPages && showPagesLeft ? (
                <span className='text-start'>
                  {localize ? (
                    <Trans
                      i18nKey='{{number}} pages left in chapter'
                      values={{ number: formatNumber(pagesLeft, localize, lang) }}
                    >
                      <span className='pages-left-number'>{'{{number}}'}</span>
                      <span className='pages-left-label'>{' pages left in chapter'}</span>
                    </Trans>
                  ) : (
                    <Trans i18nKey='{{count}} pages left in chapter' count={pagesLeft}>
                      <span className='pages-left-number'>{'{{count}}'}</span>
                      <span className='pages-left-label'>{' pages left in chapter'}</span>
                    </Trans>
                  )}
                </span>
              ) : null}
            </div>
          )}

        {showStatusInfo && (
          <StatusInfo
            showTime={
              (progressBarMode === 'all' || progressBarMode.includes('time')) && hasTimeInfo
            }
            use24Hour={viewSettings.use24HourClock}
            showBattery={
              (progressBarMode === 'all' || progressBarMode.includes('battery')) && hasBatteryInfo
            }
            showBatteryPercentage={viewSettings.showBatteryPercentage}
            isVertical={isVertical}
            isEink={isEink}
          />
        )}

        <div className='progress-info flex-1 items-center overflow-hidden whitespace-nowrap text-end tabular-nums'>
          {(progressBarMode === 'all' || progressBarMode.includes('progress')) && (
            <>
              {viewSettings.showProgressInfo && (
                <span
                  className={clsx(
                    'progress-info-label text-end',
                    isVertical ? 'mt-auto' : 'ms-auto',
                  )}
                >
                  {progressInfo}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
