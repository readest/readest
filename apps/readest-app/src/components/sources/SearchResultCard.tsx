/**
 * Search Result Card Component
 * Displays a single search result with source information
 */

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { SourceSearchResult, SourceProviderType } from '@/types/sources';
import { getProviderIcon, getSourceTypeBadgeColor } from './SourceIcons';
import {
  IoDownload,
  IoPlay,
  IoDocumentText,
  IoBook,
  IoGlobe,
  IoLockOpen,
  IoInfinite,
  IoChevronDown,
  IoChevronUp,
} from 'react-icons/io5';

interface SearchResultCardProps {
  result: SourceSearchResult;
  onDownload: () => void;
  onStream: () => void;
}

export default function SearchResultCard({
  result,
  onDownload,
  onStream,
}: SearchResultCardProps) {
  const _ = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const SourceIcon = getProviderIcon(result.sourceId, result.sourceType);
  const hasStreaming = !!result.streamingUrl;

  return (
    <div className='card border-base-300 bg-base-100 border shadow-sm transition-shadow hover:shadow-md'>
      {/* Source badge */}
      <div className='card-title mb-0 flex items-center justify-between p-4 pb-2'>
        <div className='flex items-center gap-2'>
          <SourceIcon className={`h-4 w-4 ${getSourceTypeBadgeColor(result.sourceType).split(' ')[0]}`} />
          <span className='text-sm font-medium'>{result.sourceName}</span>
        </div>
        <span className={`badge badge-xs ${getSourceTypeBadgeColor(result.sourceType)}`}>
          {result.sourceType.replace('_', ' ')}
        </span>
      </div>

      {/* Cover and info */}
      <div className='card-body p-4 pt-2'>
        <div className='flex gap-3'>
          {/* Cover image */}
          {result.coverUrl ? (
            <div className='flex-shrink-0'>
              <img
                src={result.coverUrl}
                alt={result.title}
                className='h-32 w-24 rounded object-cover shadow-sm'
              />
            </div>
          ) : (
            <div className='bg-base-300 flex h-32 w-24 flex-shrink-0 items-center justify-center rounded'>
              {result.sourceType === SourceProviderType.DOI_RESOLVER ? (
                <IoDocumentText className='text-base-content/30 h-8 w-8' />
              ) : (
                <IoBook className='text-base-content/30 h-8 w-8' />
              )}
            </div>
          )}

          {/* Info */}
          <div className='min-w-0 flex-1'>
            <h3 className='text-base font-semibold line-clamp-2'>{result.title}</h3>
            
            {result.authors && result.authors.length > 0 && (
              <p className='text-base-content/70 mt-1 text-sm line-clamp-2'>
                {result.authors.join(', ')}
              </p>
            )}

            <div className='text-base-content/50 mt-2 flex flex-wrap gap-2 text-xs'>
              {result.year && (
                <span>{result.year}</span>
              )}
              {result.language && (
                <span className='badge badge-ghost badge-xs'>{result.language}</span>
              )}
              {result.format && (
                <span className='badge badge-ghost badge-xs'>{result.format}</span>
              )}
              {result.size && (
                <span>{result.size}</span>
              )}
            </div>

            {/* DOI/ISBN badges */}
            <div className='text-base-content/50 mt-2 flex flex-wrap gap-1'>
              {result.doi && (
                <span className='badge badge-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'>
                  DOI
                </span>
              )}
              {result.isbn && (
                <span className='badge badge-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'>
                  ISBN
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Description (expandable) */}
        {result.description && (
          <div className='text-base-content/70 mt-3 text-sm'>
            {expanded ? (
              <>
                <p className='line-clamp-none'>{result.description}</p>
                <button
                  onClick={() => setExpanded(false)}
                  className='text-primary mt-1 flex items-center gap-1 text-xs'
                >
                  <IoChevronUp className='h-3 w-3' />
                  {_('Show less')}
                </button>
              </>
            ) : (
              <>
                <p className='line-clamp-2'>{result.description}</p>
                <button
                  onClick={() => setExpanded(true)}
                  className='text-primary mt-1 flex items-center gap-1 text-xs'
                >
                  <IoChevronDown className='h-3 w-3' />
                  {_('Show more')}
                </button>
              </>
            )}
          </div>
        )}

        {/* Subjects */}
        {result.subjects && result.subjects.length > 0 && (
          <div className='text-base-content/50 mt-3 flex flex-wrap gap-1'>
            {result.subjects.slice(0, 5).map((subject, index) => (
              <span key={index} className='badge badge-ghost badge-xs'>
                {subject}
              </span>
            ))}
            {result.subjects.length > 5 && (
              <span className='badge badge-ghost badge-xs'>
                +{result.subjects.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className='card-actions mt-4 justify-end gap-2'>
          {hasStreaming && (
            <button
              onClick={onStream}
              className='btn btn-sm btn-ghost gap-2'
            >
              <IoPlay className='h-4 w-4' />
              {_('Read Online')}
            </button>
          )}
          {result.downloadUrl && (
            <button
              onClick={onDownload}
              className='btn btn-sm btn-primary gap-2'
            >
              <IoDownload className='h-4 w-4' />
              {_('Download')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
