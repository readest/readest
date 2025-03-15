import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { PageInfo } from '@/types/book';

interface PageInfoProps {
  bookFormat: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  isVertical: boolean;
  horizontalGap: number;
  verticalMargin: number;
}

const PageInfoView: React.FC<PageInfoProps> = ({
  bookFormat,
  section,
  pageinfo,
  isVertical,
  horizontalGap,
  verticalMargin,
}) => {
  const _ = useTranslation();
  const pageInfo =
    bookFormat === 'PDF'
      ? section
        ? isVertical
          ? `${section.current + 1} · ${section.total}`
          : `${section.current + 1} / ${section.total}`
        : ''
      : pageinfo
        ? _(
            isVertical ? '{{currentPage}} · {{totalPage}}' : 'Loc. {{currentPage}} / {{totalPage}}',
            {
              currentPage: pageinfo.current + 1,
              totalPage: pageinfo.total,
            },
          )
        : '';

  return (
    <div
      className={clsx(
        'pageinfo absolute bottom-0 flex items-center justify-end',
        isVertical ? 'left-0' : 'right-0',
        isVertical ? 'writing-vertical-rl w-[32px]' : 'h-12',
      )}
      style={
        isVertical
          ? {
              bottom: `calc(${horizontalGap / 2}% + ${verticalMargin}px)`,
              left: `calc(${horizontalGap * 2}% - 32px)`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : { paddingRight: `${horizontalGap}%` }
      }
    >
      <h2 className='text-neutral-content text-right font-sans text-xs font-extralight'>
        {pageInfo}
      </h2>
    </div>
  );
};

export default PageInfoView;
