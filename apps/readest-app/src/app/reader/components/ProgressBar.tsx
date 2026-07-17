import clsx from 'clsx';
import React, { useMemo } from 'react';
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
import { SIZE_PER_LOC, SIZE_PER_TIME_UNIT } from '@/services/constants';
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
  const { appService } = useEnv();
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

  const hasRemainingInfo = viewSettings.showRemainingTime || viewSettings.showRemainingPages;
  const hasTimeInfo = viewSettings.showCurrentTime;
  const hasBatteryInfo = viewSettings.showCurrentBatteryStatus;

  // The footer is display-only: the full-width container stays
  // pointer-events-none so it never intercepts taps or text selection over
  // book content along the bottom of the page. To hide it, use Settings →
  // Layout → Show Footer.
  //
  // Scrolled mode reserves no bottom band (footerReservesBand) — the info
  // floats over the book text, so each segment carries its own shrink-wrapped
  // pill backdrop to stay legible instead of a full-width bar.
  const pillClass =
    viewSettings.scrolled &&
    !isVertical &&
    !stickyBarActive &&
    'progress-pill eink-bordered rounded-md bg-base-100/85 px-1.5';
  const showStatusInfo = hasTimeInfo || hasBatteryInfo;

  return (
    <div
      role='presentation'
      className={clsx(
        'progressinfo pointer-events-none absolute bottom-0 flex items-center justify-between font-sans',
        isEink ? 'text-sm font-normal' : 'text-xs font-extralight',
        bookData?.isFixedLayout && !isEink
          ? 'text-white/75 mix-blend-difference'
          : 'text-base-content',
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
          stickyBarActive ? 'gap-x-3' : 'justify-between gap-x-2',
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
        {hasRemainingInfo && (
          <div
            className={clsx(
              'remaining-info text-start truncate',
              !stickyBarActive && 'flex-1 min-w-0',
            )}
          >
            {viewSettings.showRemainingTime ? (
              <span className={clsx('time-left-label text-start', pillClass)}>{timeLeftStr}</span>
            ) : viewSettings.showRemainingPages && showPagesLeft ? (
              <span className={clsx('text-start', pillClass)}>
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
            showTime={hasTimeInfo}
            use24Hour={viewSettings.use24HourClock}
            showBattery={hasBatteryInfo}
            showBatteryPercentage={viewSettings.showBatteryPercentage}
            isVertical={isVertical}
            isEink={isEink}
            className={pillClass || undefined}
          />
        )}

        <div
          className={clsx(
            'progress-info items-center text-end tabular-nums truncate',
            !stickyBarActive && 'flex-1 min-w-0',
          )}
        >
          {viewSettings.showProgressInfo && (
            <span
              className={clsx(
                'progress-info-label text-end',
                isVertical ? 'mt-auto' : 'ms-auto',
                pillClass,
              )}
            >
              {progressInfo}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
