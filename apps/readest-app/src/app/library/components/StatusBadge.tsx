import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished' && status !== 'unread') return null;

  const isFinished = status === 'finished';

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center',
        'rounded-[1px] px-0.5',
        'text-[8px] font-bold uppercase leading-none tracking-wider',
        'h-3.5',
        // finished: green/emerald
        isFinished && 'bg-emerald-100 dark:bg-emerald-900/90',
        isFinished && 'border border-emerald-300/50 dark:border-emerald-700/50',
        isFinished && 'text-emerald-700 dark:text-emerald-300',
        // unread: pastel yellow/amber
        !isFinished && 'bg-amber-100 dark:bg-amber-900/80',
        !isFinished && 'border border-amber-300/50 dark:border-amber-700/50',
        !isFinished && 'text-amber-700 dark:text-amber-300',
        className,
      )}
      role='status'
    >
      <span className='relative top-[0.5px]'>{children}</span>
    </span>
  );
};

export default StatusBadge;
