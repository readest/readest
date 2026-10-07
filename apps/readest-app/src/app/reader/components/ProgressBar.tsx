import clsx from 'clsx';
import React, { useMemo, useState } from 'react';
import { Trans } from 'react-i18next';
import type { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  formatNumber,
  formatProgress,
  getChapterTickFractions,
  getChapterEndLocation,
  getReferencePageInfo,
} from '@/utils/progress';
import {
  type BottomCornerRadii,
  footerInfoVisible,
  footerReservesBand,
  getCornerClearance,
  NO_CORNERS,
} from '../utils/footerBand';
import {
  getChromeChip,
  getChromeFontSize,
  getChromeTextColor,
  isChromeStyled,
} from '../utils/headerFooterStyle';
import StatusInfo from './StatusInfo.tsx';
import StickyProgressBar from './StickyProgressBar.tsx';
import { convertPagesToTimeRemainingMinutes } from '@/app/library/utils/libraryUtils.ts';
import { formatDuration } from '@/utils/duration';
import { getMarginalInlinePadding } from '@/utils/insets';
import { SIZE_PER_LOC, SIZE_PER_TIME_UNIT } from '@/services/constants';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

interface ProgressBarProps {
  bookKey: string;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
  // The spread's Column Gap (px) in effect, 0 when none (getSpreadColumnGap).
  columnGap?: number;
  // Rounded screen corners this footer's ends run into.
  cornerRadii?: BottomCornerRadii;
  // A fixed-layout page that runs past the viewport (usePageOverflow).
  hidden?: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  bookKey,
  horizontalGap,
  contentInsets,
  gridInsets,
  columnGap = 0,
  cornerRadii = NO_CORNERS,
  hidden = false,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const isIPhoneDuo = useThemeStore((s) => s.isIPhoneDuo);
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
  const screenPagesLeft = bookData?.isFixedLayout
    ? pageInfo
      ? Math.max(pageInfo.total - pageInfo.current, 1)
      : 0
    : Math.min(Math.max(total - current, 1), pageInfo ? pageInfo.total - pageInfo.current : total);
  const chapterEnd = bookData?.isFixedLayout
    ? undefined
    : getChapterEndLocation(progress, bookData?.bookDoc?.toc);
  const chapterLocationsLeft =
    chapterEnd !== undefined && progress
      ? Math.max(1, chapterEnd - progress.pageinfo.current)
      : undefined;
  const sectionFractions = view?.getSectionFractions() ?? [];
  const sectionIndex = section?.current ?? 0;
  const sectionLocation = bookData?.bookDoc?.sections?.[sectionIndex]?.location;
  // Foliate rounds current/next locations down. Their difference can alternate
  // between 0, 1 and 2 for identical screens, so use the unrounded section span.
  const sectionFraction =
    (sectionFractions[sectionIndex + 1] ?? 0) - (sectionFractions[sectionIndex] ?? 0);
  const locationsPerScreen = total > 0 ? (sectionFraction * (pageinfo?.total ?? 0)) / total : 0;
  // Count from the current screen, not the rounded current location, which can
  // stay put for several page turns when a screen holds less than a location.
  // Only the chapter end (a fixed screen within this section) is estimated.
  const chapterEndScreen =
    chapterEnd === undefined || !sectionLocation || locationsPerScreen <= 0
      ? undefined
      : chapterEnd >= sectionLocation.next
        ? total + (chapterEnd - sectionLocation.next) / locationsPerScreen
        : (chapterEnd - sectionLocation.current) / locationsPerScreen;
  const pagesLeft =
    chapterEndScreen !== undefined
      ? Math.max(1, Math.round(chapterEndScreen) - current)
      : screenPagesLeft;
  // Pace statistics and TOC locations use logical pages, not viewport-sized pages.
  const timePagesLeft = bookData?.isFixedLayout
    ? pagesLeft
    : (chapterLocationsLeft ??
      (progress?.timeinfo.section !== undefined
        ? (progress.timeinfo.section * SIZE_PER_TIME_UNIT) / SIZE_PER_LOC
        : pagesLeft));
  const showPagesLeft = pagesLeft > 0 && (total > 0 || !!bookData?.isFixedLayout);
  const md5 = bookData?.book?.hash;
  const medianPageDurationSecs = useMedianPageDurationSecs(md5) ?? undefined;
  // Fixed-layout formats (CBZ, PDF) have no chapter structure — every page is
  // its own section — so the remaining count is the whole book, not a chapter.
  const remainingInBook = !!bookData?.isFixedLayout;
  const showBothRemaining = viewSettings.showRemainingTime && viewSettings.showRemainingPages;
  const durationLeft = showPagesLeft
    ? formatDuration(
        convertPagesToTimeRemainingMinutes(timePagesLeft, medianPageDurationSecs),
        _,
        (n) => formatNumber(n, localize, lang),
      )
    : '';
  const timeLeftStr = showPagesLeft
    ? remainingInBook
      ? _('{{time}} left in book', { time: durationLeft })
      : _('{{time}} left in chapter', { time: durationLeft })
    : '';
  // One sentence when both are on, so "left in book/chapter" isn't said twice.
  const numberLeft = localize && showBothRemaining ? formatNumber(pagesLeft, true, lang) : '';
  const timeAndPagesLeftStr =
    showBothRemaining && showPagesLeft
      ? localize
        ? remainingInBook
          ? _('{{time}} and {{number}} pages left in book', {
              time: durationLeft,
              number: numberLeft,
            })
          : _('{{time}} and {{number}} pages left in chapter', {
              time: durationLeft,
              number: numberLeft,
            })
        : remainingInBook
          ? _('{{time}} and {{count}} pages left in book', {
              time: durationLeft,
              count: pagesLeft,
            })
          : _('{{time}} and {{count}} pages left in chapter', {
              time: durationLeft,
              count: pagesLeft,
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

  // Tap to toggle (#5293): tapping the footer hides/shows the info without
  // touching layout or settings — the reserved band stays so the book text
  // never reflows, showFooter is never written, and the state resets when the
  // book reopens. The full-width container stays pointer-events-none so taps
  // and text selection over book content pass through; only the strip (or the
  // pills in scrolled mode, see below) is a tap target.
  const [dismissed, setDismissed] = useState(false);

  // Scrolled mode reserves no bottom band (footerReservesBand) — the info
  // floats over the book text, so each segment carries its own shrink-wrapped
  // pill backdrop to stay legible instead of a full-width bar. The pills
  // double as the tap targets there: making the whole strip tappable would
  // swallow taps and text selection over the last lines of the page, so the
  // strip is only a target where it sits on reserved margin space (paginated
  // band, sticky-bar band, vertical side column).
  const hasFooterContent = stickyBarActive || footerInfoVisible(viewSettings);
  const stripTappable = hasFooterContent && (isVertical || footerReservesBand(viewSettings));
  // The sticky bar reserves the band again, so `auto` needs no pill there; a
  // color the reader chose still paints, since they asked to see it (#5938).
  const chip = getChromeChip(viewSettings, 'footer', {
    isEink,
    isScrolled: !!viewSettings.scrolled,
    isVertical: !!isVertical,
    bandReserved: stickyBarActive,
  });
  // The segment is the tap target for #5293 wherever the info floats over the
  // text -- that has to hold even when the reader turns the backdrop off, or
  // "Background: none" would silently take tap-to-toggle away with it.
  const pillTappable = !!viewSettings.scrolled && !isVertical && !stickyBarActive;
  const pillClass =
    (pillTappable || chip) &&
    clsx(
      'progress-pill rounded-md px-1.5',
      pillTappable && 'pointer-events-auto cursor-pointer',
      chip && 'eink-bordered',
      chip?.kind === 'theme' && 'bg-base-100/85',
    );
  const pillStyle = chip?.kind === 'custom' ? { backgroundColor: chip.color } : undefined;
  const textColor = getChromeTextColor(viewSettings, isEink);
  const fontSize = getChromeFontSize(viewSettings, isEink);
  const showStatusInfo = hasTimeInfo || hasBatteryInfo;

  // The text is centered in the marginBottomPx strip, so on phones with rounded
  // screen corners a small bottom margin drops its ends into the corner arc.
  // Pull them inward just enough to clear it; the book layout is untouched.
  const bottomPadding = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
  const textBottom = bottomPadding + viewSettings.marginBottomPx / 2 - fontSize / 2;
  const cornerClearance = (radius: number) =>
    isVertical ? 0 : getCornerClearance(radius, textBottom);
  const inlinePadding = (inset: number, clearance: number, hostOffset = 0) => {
    const padding = getMarginalInlinePadding(horizontalGap, inset, columnGap, hostOffset);
    return clearance > 0 ? `max(${padding}, ${clearance.toFixed(1)}px)` : padding;
  };

  return (
    <div
      role='presentation'
      className={clsx(
        'progressinfo pointer-events-none absolute bottom-0 z-10 flex items-center justify-between font-sans',
        isEink ? 'font-normal' : 'font-extralight',
        // The blend keeps the info legible over an unthemed fixed-layout page,
        // but it composites the whole container as a group -- with the pills on
        // it differences a white pill against the white page and paints it pure
        // black (#5342). The pill backdrop already guarantees legibility, so it
        // takes over from the blend whenever it is present. A reader who set
        // their own color or backdrop (#5938) has taken over too: the blend
        // would invert their text color and black out their chip.
        bookData?.isFixedLayout && !isEink && !pillClass && !isChromeStyled(viewSettings)
          ? 'text-white/75 mix-blend-difference'
          : 'text-base-content',
        isVertical ? 'writing-vertical-rl' : 'w-full',
        hidden && 'invisible',
      )}
      aria-label={[
        progress
          ? _('On {{current}} of {{total}} page', {
              current: current + 1,
              total: total,
            })
          : '',
        ...(showBothRemaining ? [timeAndPagesLeftStr] : [timeLeftStr, pagesLeftStr]),
      ]
        .filter(Boolean)
        .join(', ')}
      style={{
        // Set on the container so the pills, the status widgets and the sticky
        // bar (which inherits currentColor) all resolve from one place.
        fontSize: `${fontSize}px`,
        ...(textColor ? { color: textColor } : {}),
        ...(isVertical
          ? {
              top: `${(contentInsets.top - gridInsets.top) * 1.5}px`,
              bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
              left: showDoubleBorder
                ? `calc(${contentInsets.left}px)`
                : `calc(${Math.max(0, contentInsets.left - 32)}px)`,
              width: showDoubleBorder ? '32px' : `${contentInsets.left}px`,
            }
          : {
              ...(isIPhoneDuo
                ? {
                    // Half the page margin past the safe-area inset, matching
                    // the paginator's gutter (#6307), and clear of a rounded
                    // corner. Physical sides: the insets are.
                    paddingLeft: inlinePadding(
                      contentInsets.left + gridInsets.left,
                      cornerClearance(cornerRadii.left),
                      gridInsets.left,
                    ),
                    paddingRight: inlinePadding(
                      contentInsets.right + gridInsets.right,
                      cornerClearance(cornerRadii.right),
                      gridInsets.right,
                    ),
                  }
                : {
                    // The reader never sets dir=rtl on this container, so
                    // inline start is always the physical left.
                    paddingInlineStart: inlinePadding(
                      contentInsets.left,
                      cornerClearance(cornerRadii.left),
                    ),
                    paddingInlineEnd: inlinePadding(
                      contentInsets.right,
                      cornerClearance(cornerRadii.right),
                    ),
                  }),
              paddingBottom: bottomPadding ? `${bottomPadding}px` : 0,
            }),
      }}
    >
      <div
        aria-hidden='true'
        onClick={hasFooterContent ? () => setDismissed((prev) => !prev) : undefined}
        className={clsx(
          'progress-strip flex items-center',
          stripTappable && 'pointer-events-auto cursor-pointer',
          dismissed && 'opacity-0',
          !isEink && 'transition-opacity duration-300',
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
            {showBothRemaining ? (
              <span className={clsx('time-left-label text-start', pillClass)} style={pillStyle}>
                {timeAndPagesLeftStr}
              </span>
            ) : viewSettings.showRemainingTime ? (
              <span className={clsx('time-left-label text-start', pillClass)} style={pillStyle}>
                {timeLeftStr}
              </span>
            ) : viewSettings.showRemainingPages && showPagesLeft ? (
              <span className={clsx('text-start', pillClass)} style={pillStyle}>
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
            style={pillStyle}
          />
        )}

        <div
          className={clsx(
            'progress-readout items-center text-end tabular-nums truncate',
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
              style={pillStyle}
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
