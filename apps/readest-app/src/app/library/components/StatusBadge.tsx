import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished') return null;

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center',
        'rounded-[1px] px-0.5',
        'bg-emerald-100 dark:bg-emerald-900/90',
        'border border-emerald-300/50 dark:border-emerald-700/50',
        'text-emerald-700 dark:text-emerald-300',
        'text-[8px] font-bold uppercase leading-none tracking-wider',
        'h-3.5',
        className,
      )}
      role='status'
    >
      <span className='relative top-[0.5px]'>{children}</span>
    </span>
  );
};

export default StatusBadge;
