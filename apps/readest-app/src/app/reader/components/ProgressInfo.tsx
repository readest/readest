import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { PageInfo, TimeInfo } from '@/types/book';

interface PageInfoProps {
  bookKey: string;
  bookFormat: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  timeinfo?: TimeInfo;
  horizontalGap: number;
  verticalMargin: number;
}

const ProgressInfoView: React.FC<PageInfoProps> = ({
  bookKey,
  bookFormat,
  section,
  pageinfo,
  timeinfo,
  horizontalGap,
  verticalMargin,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

  const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
  const isScrolled = viewSettings.scrolled;
  const isVertical = viewSettings.vertical;
  const pageInfo = ['PDF', 'CBZ'].includes(bookFormat)
    ? section
      ? isVertical
        ? `${section.current + 1} · ${section.total}`
        : `${section.current + 1} / ${section.total}`
      : ''
    : pageinfo
      ? _(isVertical ? '{{currentPage}} · {{totalPage}}' : 'Loc. {{currentPage}} / {{totalPage}}', {
          currentPage: pageinfo.current + 1,
          totalPage: pageinfo.total,
        })
      : '';
  const timeInfo = timeinfo
    ? _('{{time}} min left in chapter', { time: Math.round(timeinfo.section) })
    : '';

  return (
    <div
      className={clsx(
        'pageinfo absolute bottom-0 flex items-center justify-between',
        'text-neutral-content font-sans text-xs font-extralight',
        isVertical ? 'writing-vertical-rl' : 'h-12 w-full',
        isScrolled && !isVertical && 'bg-base-100',
      )}
      style={
        isVertical
          ? {
              bottom: `${verticalMargin * 1.5}px`,
              left: showDoubleBorder ? `calc(${horizontalGap}% - 32px)` : 0,
              width: showDoubleBorder ? '32px' : `${horizontalGap}%`,
              height: `calc(100% - ${verticalMargin * 3}px)`,
            }
          : {
              paddingInlineStart: `${horizontalGap}%`,
              paddingInlineEnd: `${horizontalGap}%`,
              paddingBottom: appService?.hasSafeAreaInset
                ? 'calc(env(safe-area-inset-bottom)*0.67)'
                : 0,
            }
      }
    >
      {viewSettings.showRemainingTime && <span className='text-start'>{timeInfo}</span>}
      {viewSettings.showPageNumber && <span className='ms-auto text-end'>{pageInfo}</span>}
    </div>
  );
};

export default ProgressInfoView;
