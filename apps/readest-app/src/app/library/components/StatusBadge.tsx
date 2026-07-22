import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished' && status !== 'unread' && status !== 'abandoned') return null;

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center',
        'rounded-[1px] px-0.5',
        'text-[8px] font-bold uppercase leading-none tracking-wider',
        'h-3.5',
        status === 'finished' && 'status-badge-finished',
        status === 'unread' && 'status-badge-unread',
        status === 'abandoned' && 'status-badge-abandoned',
        // finished: green/emerald
        status === 'finished' && 'bg-emerald-100 dark:bg-emerald-900/90',
        status === 'finished' && 'border border-emerald-300/50 dark:border-emerald-700/50',
        status === 'finished' && 'text-emerald-700 dark:text-emerald-300',
        // unread: pastel yellow/amber
        status === 'unread' && 'bg-amber-100 dark:bg-amber-900/80',
        status === 'unread' && 'border border-amber-300/50 dark:border-amber-700/50',
        status === 'unread' && 'text-amber-700 dark:text-amber-300',
        // abandoned / on hold: slate
        status === 'abandoned' && 'bg-slate-100 dark:bg-slate-800/80',
        status === 'abandoned' && 'border border-slate-300/50 dark:border-slate-600/50',
        status === 'abandoned' && 'text-slate-700 dark:text-slate-300',
        className,
      )}
      role='status'
    >
      <span className='relative top-[0.5px]'>{children}</span>
    </span>
  );
};

export default StatusBadge;
