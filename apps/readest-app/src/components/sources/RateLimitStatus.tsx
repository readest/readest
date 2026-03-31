/**
 * Rate Limit Status Component
 * Shows current rate limiter status for all source types
 */

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { IoStatsChart, IoInformationCircle } from 'react-icons/io5';

interface RateLimitStatusProps {
  status?: {
    totalQueued: number;
    totalActive: number;
    bySourceType: Record<string, { queued: number; active: number }>;
  };
}

export default function RateLimitStatus({ status }: RateLimitStatusProps) {
  const _ = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  if (!status) return null;

  return (
    <div className='relative'>
      <button
        onClick={() => setShowDetails(!showDetails)}
        className='text-base-content/50 hover:text-base-content flex items-center gap-1 text-xs'
      >
        <IoStatsChart className='h-4 w-4' />
        {_('Rate Limit')}
        {status.totalActive > 0 && (
          <span className='badge badge-xs badge-primary'>
            {status.totalActive} active
          </span>
        )}
      </button>

      {showDetails && (
        <div className='absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-base-300 bg-base-100 p-3 shadow-lg'>
          <h4 className='mb-2 flex items-center gap-2 text-xs font-semibold'>
            <IoInformationCircle className='h-4 w-4' />
            {_('Rate Limit Status')}
          </h4>
          
          <div className='space-y-2 text-xs'>
            <div className='flex justify-between'>
              <span className='text-base-content/70'>{_('Queued')}:</span>
              <span className='font-medium'>{status.totalQueued}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-base-content/70'>{_('Active')}:</span>
              <span className='font-medium'>{status.totalActive}</span>
            </div>
          </div>

          <div className='text-base-content/50 mt-3 border-t border-base-300 pt-2 text-xs'>
            {_('Requests are rate-limited to prevent server overload')}
          </div>
        </div>
      )}
    </div>
  );
}
