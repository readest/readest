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
        'h-6 rounded-full px-2.5',
        'border text-[10px] font-semibold uppercase leading-none tracking-[0.16em]',
        isFinished && 'status-badge-finished',
        !isFinished && 'status-badge-unread',
        isFinished && 'border-[rgba(185,133,44,0.38)] bg-[rgba(185,133,44,0.14)] text-[#e0c48e]',
        !isFinished && 'border-[rgba(128,98,61,0.34)] bg-[rgba(255,255,255,0.03)] text-[#a88b61]',
        className,
      )}
      role='status'
    >
      <span>{children}</span>
    </span>
  );
};

export default StatusBadge;
