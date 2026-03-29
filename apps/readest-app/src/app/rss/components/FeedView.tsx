'use client';

import { RSSFeed, RSSItem } from '@/types/rss';
import { useTranslation } from '@/hooks/useTranslation';

interface FeedViewProps {
  feed: RSSFeed;
  onItemSelect: (item: RSSItem) => void;
  onGenerateCachedImageUrl?: (url: string) => Promise<string>;
}

export function FeedView({ feed, onItemSelect, onGenerateCachedImageUrl }: FeedViewProps) {
  const _ = useTranslation();

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const extractPreviewText = (description?: string) => {
    if (!description) return '';
    // Remove HTML tags
    const plain = description.replace(/<[^>]*>/g, ' ');
    // Truncate
    return plain.length > 200 ? plain.slice(0, 200) + '...' : plain;
  };

  return (
    <div className='p-6'>
      {/* Feed Header */}
      {feed.metadata.title && (
        <div className='mb-6'>
          <h1 className='text-2xl font-bold'>{feed.metadata.title}</h1>
          {feed.metadata.subtitle && (
            <p className='text-base-content/70 mt-1'>{feed.metadata.subtitle}</p>
          )}
          {feed.metadata.description && (
            <p className='text-base-content/70 mt-2'>{feed.metadata.description}</p>
          )}
        </div>
      )}

      {/* Feed Items */}
      <div className='flex flex-col gap-4'>
        {feed.items.map((item, index) => (
          <div
            key={item.metadata.guid || index}
            className='card bg-base-200 cursor-pointer transition-colors hover:bg-base-300'
            onClick={() => onItemSelect(item)}
          >
            <div className='card-body p-4'>
              <div className='flex items-start justify-between gap-4'>
                <div className='flex-1'>
                  <h3 className='text-lg font-semibold'>{item.metadata.title}</h3>

                  <div className='text-base-content/70 mt-1 flex flex-wrap items-center gap-2 text-sm'>
                    {item.metadata.author && (
                      <span>{item.metadata.author}</span>
                    )}
                    {item.metadata.pubDate && (
                      <>
                        <span>•</span>
                        <time>{formatDate(item.metadata.pubDate)}</time>
                      </>
                    )}
                    {item.metadata.doi && (
                      <>
                        <span>•</span>
                        <span className='badge badge-primary badge-sm'>DOI</span>
                      </>
                    )}
                  </div>

                  {item.metadata.description && (
                    <p className='text-base-content/70 mt-2 line-clamp-2 text-sm'>
                      {extractPreviewText(item.metadata.description)}
                    </p>
                  )}

                  {item.metadata.subject && item.metadata.subject.length > 0 && (
                    <div className='flex flex-wrap gap-1 mt-3'>
                      {item.metadata.subject.slice(0, 5).map((subject, idx) => (
                        <span key={idx} className='badge badge-ghost badge-xs'>
                          {subject}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* PDF Indicator */}
                {item.enclosures?.some((e) => e.type?.includes('pdf')) ||
                item.links?.some((l) => l.type?.includes('pdf')) ? (
                  <div className='text-primary flex-shrink-0'>
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      className='h-6 w-6'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                      />
                    </svg>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {feed.items.length === 0 && (
        <div className='flex h-64 items-center justify-center'>
          <p className='text-base-content/70'>{_('No articles in this feed')}</p>
        </div>
      )}
    </div>
  );
}
