import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { PageInfo } from '@/types/book';

interface PageInfoProps {
  bookFormat: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  showDoubleBorder: boolean;
  isScrolled: boolean;
  isVertical: boolean;
  horizontalGap: number;
  verticalMargin: number;
}

const PageInfoView: React.FC<PageInfoProps> = ({
  bookFormat,
  section,
  pageinfo,
  showDoubleBorder,
  isScrolled,
  isVertical,
  horizontalGap,
  verticalMargin,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const pageInfo = ['PDF', 'CBZ'].includes(bookFormat)
    ? section
      ? isVertical
        ? `${section.current + 1} · ${section.total}`
        : `${section.current + 1} / ${section.total}`
      : ''
    : pageinfo
      ? _(isVertical ? '{{currentPage}} · {{totalPage}}' : 'Loc. {{currentPage}} / {{totalPage}}', {
          currentPage: (pageinfo.next ?? pageinfo.current) + 1,
          totalPage: pageinfo.total,
        })
      : '';

  return (
    <div
      className={clsx(
        'pageinfo absolute bottom-0 flex items-center justify-end',
        isVertical ? 'writing-vertical-rl' : 'h-12 w-full',
        isScrolled && !isVertical && 'bg-base-100',
      )}
      style={
        isVertical
          ? {
              bottom: `${verticalMargin * 1.5}px`,
              left: showDoubleBorder ? `calc(${horizontalGap}% - 32px)` : 0,
              width: showDoubleBorder ? '32px' : `${horizontalGap}%`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : {
              insetInlineEnd: `${horizontalGap}%`,
              paddingBottom: appService?.hasSafeAreaInset ? 'env(safe-area-inset-bottom)' : 0,
            }
      }
    >
      <h2 className='text-neutral-content text-right font-sans text-xs font-extralight'>
        {pageInfo}
      </h2>
    </div>
  );
};

export default PageInfoView;
