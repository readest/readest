/**
 * Search Progress Panel
 * Shows real-time progress for each source during search
 */

import { useTranslation } from '@/hooks/useTranslation';
import { SearchProgress } from '@/types/sources';
import { IoCheckmarkCircle, IoCloseCircle, IoHourglass, IoStatsChart } from 'react-icons/io5';

interface SearchProgressPanelProps {
  progress: SearchProgress[];
}

export default function SearchProgressPanel({ progress }: SearchProgressPanelProps) {
  const _ = useTranslation();

  const completed = progress.filter(p => p.status === 'completed').length;
  const searching = progress.filter(p => p.status === 'searching').length;
  const error = progress.filter(p => p.status === 'error').length;
  const pending = progress.filter(p => p.status === 'pending').length;

  return (
    <div className='mb-6 rounded-lg border border-base-300 bg-base-200 p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>{_('Search Progress')}</h3>
        <div className='flex items-center gap-4 text-xs'>
          <span className='flex items-center gap-1 text-success'>
            <IoCheckmarkCircle className='h-3 w-3' />
            {completed}
          </span>
          <span className='flex items-center gap-1 text-primary'>
            <IoHourglass className='h-3 w-3' />
            {searching}
          </span>
          <span className='flex items-center gap-1 text-error'>
            <IoCloseCircle className='h-3 w-3' />
            {error}
          </span>
          <span className='flex items-center gap-1 text-base-content/50'>
            <IoStatsChart className='h-3 w-3' />
            {progress.length}
          </span>
        </div>
      </div>

      {/* Progress bars */}
      <div className='mb-3 flex h-2 overflow-hidden rounded-full bg-base-300'>
        {progress.length > 0 && (
          <>
            <div
              className='bg-success transition-all duration-300'
              style={{ width: `${(completed / progress.length) * 100}%` }}
            />
            <div
              className='bg-primary transition-all duration-300'
              style={{ width: `${(searching / progress.length) * 100}%` }}
            />
            <div
              className='bg-error transition-all duration-300'
              style={{ width: `${(error / progress.length) * 100}%` }}
            />
          </>
        )}
      </div>

      {/* Source status list */}
      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
        {progress.map(item => (
          <div
            key={item.sourceId}
            className='flex items-center justify-between rounded border border-base-300 bg-base-100 p-2 text-sm'
          >
            <div className='flex items-center gap-2 min-w-0'>
              {item.status === 'completed' && (
                <IoCheckmarkCircle className='text-success flex-shrink-0 h-4 w-4' />
              )}
              {item.status === 'searching' && (
                <IoHourglass className='text-primary flex-shrink-0 h-4 w-4 animate-pulse' />
              )}
              {item.status === 'error' && (
                <IoCloseCircle className='text-error flex-shrink-0 h-4 w-4' />
              )}
              {item.status === 'pending' && (
                <div className='text-base-content/30 flex-shrink-0 h-4 w-4'>
                  <div className='h-2 w-2 rounded-full bg-current' />
                </div>
              )}
              <span className='truncate font-medium'>{item.sourceName}</span>
            </div>
            <div className='flex-shrink-0 text-xs'>
              {item.status === 'completed' && (
                <span className='text-success'>{item.resultCount} results</span>
              )}
              {item.status === 'searching' && (
                <span className='text-primary'>Searching...</span>
              )}
              {item.status === 'error' && (
                <span className='text-error' title={item.error}>
                  Error
                </span>
              )}
              {item.status === 'pending' && (
                <span className='text-base-content/50'>Waiting...</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      {completed > 0 && (
        <div className='text-base-content/70 mt-3 flex items-center justify-between border-t border-base-300 pt-3 text-xs'>
          <span>
            {_('{{completed}} of {{total}} sources completed', {
              completed,
              total: progress.length,
            })}
          </span>
          {error > 0 && (
            <span className='text-error'>
              {_('{{error}} sources failed', { error })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
