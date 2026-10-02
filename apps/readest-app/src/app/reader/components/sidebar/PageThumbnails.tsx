import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { BookDoc } from '@/libs/document';
import { getCachedPageThumbnail, loadPageThumbnail } from '../../utils/pageThumbnails';

// Only rows still mounted after this delay load their thumbnails, so flinging
// through a long section doesn't queue a render for every page passed by.
const LOAD_DELAY_MS = 150;

const PageThumbnail: React.FC<{
  bookHash: string;
  bookDoc: BookDoc;
  page: number;
  isCurrent: boolean;
  onClick: (page: number) => void;
}> = ({ bookHash, bookDoc, page, isCurrent, onClick }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [url, setUrl] = useState(() => getCachedPageThumbnail(bookHash, page));
  const reloadedRef = useRef(false);
  const viewport = bookDoc.rendition.viewport;

  useEffect(() => {
    if (url || !appService) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadPageThumbnail(appService, bookHash, bookDoc, page).then((loaded) => {
        if (!cancelled) setUrl(loaded);
      });
    }, LOAD_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appService, bookHash, bookDoc, page, url]);

  return (
    <button
      type='button'
      onClick={() => onClick(page)}
      aria-label={_('Page {{number}}', { number: page + 1 })}
      aria-current={isCurrent ? 'page' : undefined}
      className='flex min-w-0 flex-col items-center gap-1 rounded-md p-1 sm:hover:bg-base-300/75'
    >
      <div
        className={clsx(
          'bg-base-100 eink:border-base-content w-full overflow-hidden rounded-sm border',
          isCurrent
            ? 'eink:ring-base-content border-transparent ring-2 ring-blue-500'
            : 'border-base-300',
        )}
        // Every page holds the first page's shape until its image arrives, so
        // rows keep a stable height for the virtualized list.
        style={{ aspectRatio: viewport ? `${viewport.width} / ${viewport.height}` : '3 / 4' }}
      >
        {url && (
          <img
            src={url}
            alt=''
            draggable={false}
            className='h-full w-full object-contain'
            // The memory cache revokes the object URLs it evicts. Should the
            // image need its URL again, fetch the thumbnail once more.
            onError={() => {
              if (reloadedRef.current) return;
              reloadedRef.current = true;
              setUrl(null);
            }}
          />
        )}
      </div>
      <span
        aria-hidden='true'
        className={clsx(
          'text-xs',
          isCurrent
            ? 'text-bold-in-eink eink:text-base-content text-blue-500'
            : 'text-base-content/50',
        )}
      >
        {page + 1}
      </span>
    </button>
  );
};

export const PageThumbnailsRow: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  depth: number;
  pages: number[];
  columns: number;
  currentPage?: number;
  onPageClick: (page: number) => void;
}> = ({ bookKey, bookDoc, depth, pages, columns, currentPage, onPageClick }) => {
  const bookHash = bookKey.split('-')[0]!;
  return (
    <div
      className='grid gap-1 pb-1 pe-4 sm:pe-2'
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        paddingInlineStart: `${depth * 12 + 8}px`,
      }}
    >
      {pages.map((page) => (
        <PageThumbnail
          key={page}
          bookHash={bookHash}
          bookDoc={bookDoc}
          page={page}
          isCurrent={page === currentPage}
          onClick={onPageClick}
        />
      ))}
    </div>
  );
};
