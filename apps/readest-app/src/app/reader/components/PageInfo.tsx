import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { PageInfo } from '@/types/book';

interface PageInfoProps {
  bookFormat: string;
  section: PageInfo | null;
  pageinfo: PageInfo | null;
  gapRight: string;
}

const PageInfoView: React.FC<PageInfoProps> = ({ bookFormat, section, pageinfo, gapRight }) => {
  const _ = useTranslation();
  const pageInfo =
    bookFormat === 'PDF'
      ? section
        ? `${section.current + 1} / ${section.total}`
        : ''
      : pageinfo
        ? _('Loc. {{currentPage}} / {{totalPage}}', {
            currentPage: pageinfo.current + 1,
            totalPage: pageinfo.total,
          })
        : '';

  return (
    <div
      className='pageinfo absolute bottom-0 left-0 right-0 flex h-12 items-center justify-end'
      style={{ paddingRight: gapRight }}
    >
      <h2 className='text-neutral-content text-right font-sans text-xs font-extralight'>
        {pageInfo}
      </h2>
    </div>
  );
};

export default PageInfoView;
