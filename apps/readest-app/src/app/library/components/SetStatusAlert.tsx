import clsx from 'clsx';
import * as React from 'react';
import { PiX } from 'react-icons/pi';
import { ReadingStatus } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

interface SetStatusAlertProps {
  selectedCount: number;
  safeAreaBottom: number;
  onCancel: () => void;
  onUpdateStatus: (status: ReadingStatus | undefined) => void;
}

const SetStatusAlert: React.FC<SetStatusAlertProps> = ({
  selectedCount,
  safeAreaBottom,
  onCancel,
  onUpdateStatus,
}) => {
  const _ = useTranslation();
  const divRef = useKeyDownActions({ onCancel });

  const statusButtons = [
    {
      label: _('Mark as Unread'),
      status: 'unread' as ReadingStatus,
      className:
        'not-eink:bg-amber-500/15 not-eink:text-amber-600 dark:not-eink:text-amber-400 not-eink:border-amber-500/20 eink-bordered',
    },
    {
      label: _('Mark as Finished'),
      status: 'finished' as ReadingStatus,
      className:
        'not-eink:bg-success/15 not-eink:text-success not-eink:border-success/20 eink-bordered',
    },
    {
      label: _('Clear Status'),
      status: undefined,
      className:
        'not-eink:bg-base-300 not-eink:text-base-content not-eink:border-base-content/10 eink-bordered',
    },
  ];

  return (
    <div
      ref={divRef}
      className={clsx('status-alert fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
      style={{
        paddingBottom: `${safeAreaBottom + 16}px`,
      }}
    >
      <div
        className={clsx(
          'flex w-auto max-w-[90vw] flex-col gap-3',
          'border-base-content/10 bg-base-200/95 rounded-2xl border p-4',
          'shadow-lg backdrop-blur-sm',
        )}
      >
        {/* Header with close button for small screens */}
        <div className='relative flex items-center justify-center'>
          <div className='text-center text-sm font-medium'>
            {_('Set status for {{count}} book(s)', { count: selectedCount })}
          </div>
          <button
            className={clsx(
              'absolute right-0 flex items-center justify-center',
              'rounded-full p-1.5 transition-colors',
              'hover:bg-base-content/10',
              'sm:hidden',
            )}
            onClick={onCancel}
            aria-label={_('Cancel')}
          >
            <PiX className='size-5' />
          </button>
        </div>
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {statusButtons.map(({ label, status, className }) => (
            <button
              key={label}
              className={clsx(
                'flex items-center gap-2 rounded-full border px-4 py-2',
                'shadow-sm transition-all duration-200 ease-out active:scale-[0.97]',
                className,
              )}
              onClick={() => onUpdateStatus(status)}
            >
              <span className='text-sm font-medium'>{label}</span>
            </button>
          ))}
          <button
            className={clsx(
              'hidden items-center gap-2 rounded-full border px-4 py-2',
              'not-eink:bg-base-300 not-eink:text-base-content not-eink:border-base-content/10 not-eink:shadow-sm',
              'eink-bordered',
              'transition-all duration-200 ease-out active:scale-[0.97]',
              'sm:flex',
            )}
            onClick={onCancel}
          >
            <span className='text-sm font-medium'>{_('Cancel')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SetStatusAlert;
