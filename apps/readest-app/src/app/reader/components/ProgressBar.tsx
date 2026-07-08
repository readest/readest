import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import { Trans } from 'react-i18next';
import type { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  formatNumber,
  formatProgress,
  getChapterTickFractions,
  getReferencePageInfo,
} from '@/utils/progress';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { SIZE_PER_LOC, SIZE_PER_TIME_UNIT } from '@/services/constants';
import type { ProgressBarMode } from '@/types/book.ts';
import StatusInfo from './StatusInfo.tsx';
import StickyProgressBar from './StickyProgressBar.tsx';

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
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const getView = useReaderStore((s) => s.getView);
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  // Reactive: this is the on-screen footer that has to refresh on every
  // page turn. Reads from readerProgressStore only.
  const progress = useBookProgress(bookKey);
  const { section, pageinfo } = progress || {};

  const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
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
  const referenceInfo =
    readingProgressStyle === 'reference'
      ? getReferencePageInfo({
          pageList: bookData?.bookDoc?.pageList,
          pageItem: progress?.pageItem,
          fraction: pageInfo && pageInfo.total > 0 ? (pageInfo.current + 1) / pageInfo.total : 0,
          referencePageCount: viewSettings.referencePageCount,
        })
      : null;
  const progressInfo = referenceInfo
    ? `${referenceInfo.current}${isVertical ? ' · ' : ' / '}${referenceInfo.total}`
    : formatProgress(pageInfo?.current, pageInfo?.total, template, localize, lang);

  // Sticky progress bar is horizontal-only; vertical mode keeps its side footer.
  const stickyBarActive = viewSettings.showStickyProgressBar && !isVertical;
  const tickFractions = useMemo(
    () => (stickyBarActive ? getChapterTickFractions(view, bookData?.bookDoc?.toc) : []),
    [stickyBarActive, view, bookData?.bookDoc?.toc],
  );
  // Same size-domain as the chapter ticks; falls back to the page fraction
  // before the first relocate has populated progress.fraction.
  const fillFraction =
    progress?.fraction ??
    (pageInfo && pageInfo.total > 0 ? (pageInfo.current + 1) / pageInfo.total : 0);

  const { page: current = 0, pages: total = 0 } = view?.renderer || {};
  const pagesLeft = bookData?.isFixedLayout
    ? pageInfo
      ? Math.max(pageInfo.total - pageInfo.current, 1)
      : 0
    : Math.min(Math.max(total - current, 1), pageInfo ? pageInfo.total - pageInfo.current : total);
  const showPagesLeft = pagesLeft > 0 && (total > 0 || !!bookData?.isFixedLayout);
  // Fixed-layout formats (CBZ, PDF) have no chapter structure — every page is
  // its own section — so the remaining count is the whole book, not a chapter.
  const remainingInBook = !!bookData?.isFixedLayout;
  const timeLeftStr = showPagesLeft
    ? remainingInBook
      ? _('{{time}} min left in book', {
          time: formatNumber(
            Math.round((pagesLeft * SIZE_PER_LOC) / SIZE_PER_TIME_UNIT),
            localize,
            lang,
          ),
        })
      : _('{{time}} min left in chapter', {
          time: formatNumber(
            Math.round((pagesLeft * SIZE_PER_LOC) / SIZE_PER_TIME_UNIT),
            localize,
            lang,
          ),
        })
    : '';
  const pagesLeftStr = showPagesLeft
    ? localize
      ? remainingInBook
        ? _('{{number}} pages left in book', {
            number: formatNumber(pagesLeft, localize, lang),
          })
        : _('{{number}} pages left in chapter', {
            number: formatNumber(pagesLeft, localize, lang),
          })
      : remainingInBook
        ? _('{{count}} pages left in book', {
            count: pagesLeft,
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

  // Only the shrink-wrapped info elements are tap targets; the full-width
  // container stays pointer-events-none so the footer never intercepts taps
  // or text selection over book content along the bottom of the page. The
  // targets also outrank the footer-bar hover strip (z-10 vs z-0), so
  // mousing over the info text doesn't summon the nav bar before the user
  // can click the text to toggle it.
  const tapTargetsEnabled = viewSettings.tapToToggleFooter;
  const handleInfoClick = () => {
    if (eventDispatcher.dispatchSync('iframe-single-click')) return;
    cycleProgressInfoModes();
  };
  const tapTargetClass = tapTargetsEnabled && 'cursor-pointer pointer-events-auto';
  // Scrolled mode reserves no bottom band (footerReservesBand) — the info
  // floats over the book text, so each segment carries its own shrink-wrapped
  // pill backdrop to stay legible instead of a full-width bar.
  const pillClass =
    viewSettings.scrolled &&
    !isVertical &&
    !stickyBarActive &&
    'progress-pill eink-bordered rounded-md bg-base-100/85 px-1.5';
  const showStatusInfo =
    (progressBarMode === 'all' ||
      progressBarMode.includes('battery') ||
      progressBarMode.includes('time')) &&
    (hasTimeInfo || hasBatteryInfo);

  return (
    <div
      role='presentation'
      className={clsx(
        'progressinfo pointer-events-none absolute bottom-0 z-10 flex items-center justify-between font-sans',
        isEink ? 'text-sm font-normal' : 'text-neutral-content text-xs font-extralight',
        isVertical ? 'writing-vertical-rl' : 'w-full',
      )}
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
          'flex items-center',
          isVertical ? 'h-full' : 'w-full',
          // Sticky bar grows on the left; the info widgets pack to the right
          // with even gaps. Without it, keep the 3-zone left/center/right row.
          stickyBarActive ? 'gap-x-3' : 'justify-between',
        )}
        style={isVertical ? {} : { height: `${viewSettings.marginBottomPx}px` }}
      >
        {stickyBarActive && (
          <StickyProgressBar
            className='h-3 flex-1'
            fraction={fillFraction}
            tickFractions={tickFractions}
            rtl={viewSettings.rtl}
            isEink={isEink}
          />
        )}
        {/* In 'none' mode nothing renders (and the layout band collapses), so
            leave two small invisible pads at the ends of the row — where the
            info sat — as the only tap targets to bring the footer back. */}
        {tapTargetsEnabled && progressBarMode === 'none' && (
          <div
            role='none'
            className={clsx(
              'progress-restore-pad cursor-pointer pointer-events-auto',
              isVertical ? 'h-11 w-full' : 'h-full w-11',
            )}
            onClick={handleInfoClick}
          />
        )}
        {(progressBarMode === 'all' || progressBarMode.includes('remaining')) &&
          hasRemainingInfo && (
            <div
              className={clsx(
                'remaining-info whitespace-nowrap text-start',
                !stickyBarActive && 'flex-1',
                showStatusInfo && 'overflow-hidden',
                bookData?.isFixedLayout && !isEink
                  ? 'text-white/75 mix-blend-difference'
                  : 'text-base-content',
              )}
            >
              {viewSettings.showRemainingTime ? (
                <span
                  className={clsx('time-left-label text-start', tapTargetClass, pillClass)}
                  onClick={handleInfoClick}
                >
                  {timeLeftStr}
                </span>
              ) : viewSettings.showRemainingPages && showPagesLeft ? (
                <span
                  className={clsx('text-start', tapTargetClass, pillClass)}
                  onClick={handleInfoClick}
                >
                  {localize ? (
                    remainingInBook ? (
                      <Trans
                        i18nKey='{{number}} pages left in book'
                        values={{ number: formatNumber(pagesLeft, localize, lang) }}
                      >
                        <span className='pages-left-number'>{'{{number}}'}</span>
                        <span className='pages-left-label'>{' pages left in book'}</span>
                      </Trans>
                    ) : (
                      <Trans
                        i18nKey='{{number}} pages left in chapter'
                        values={{ number: formatNumber(pagesLeft, localize, lang) }}
                      >
                        <span className='pages-left-number'>{'{{number}}'}</span>
                        <span className='pages-left-label'>{' pages left in chapter'}</span>
                      </Trans>
                    )
                  ) : remainingInBook ? (
                    <Trans i18nKey='{{count}} pages left in book' count={pagesLeft}>
                      <span className='pages-left-number'>{'{{count}}'}</span>
                      <span className='pages-left-label'>{' pages left in book'}</span>
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
            className={clsx(tapTargetClass, pillClass) || undefined}
            onClick={tapTargetsEnabled ? handleInfoClick : undefined}
          />
        )}

        <div
          className={clsx(
            'progress-info items-center overflow-hidden whitespace-nowrap text-end tabular-nums',
            !stickyBarActive && 'flex-1',
            bookData?.isFixedLayout && !isEink
              ? 'text-white/75 mix-blend-difference'
              : 'text-base-content',
          )}
        >
          {(progressBarMode === 'all' || progressBarMode.includes('progress')) && (
            <>
              {viewSettings.showProgressInfo && (
                <span
                  className={clsx(
                    'progress-info-label text-end',
                    isVertical ? 'mt-auto' : 'ms-auto',
                    tapTargetClass,
                    pillClass,
                  )}
                  onClick={handleInfoClick}
                >
                  {progressInfo}
                </span>
              )}
            </>
          )}
        </div>
        {tapTargetsEnabled && progressBarMode === 'none' && (
          <div
            role='none'
            className={clsx(
              'progress-restore-pad cursor-pointer pointer-events-auto',
              isVertical ? 'h-11 w-full' : 'h-full w-11',
            )}
            onClick={handleInfoClick}
          />
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
