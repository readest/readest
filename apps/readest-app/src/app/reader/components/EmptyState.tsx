import * as React from 'react';
import clsx from 'clsx';
import { IconType } from 'react-icons';

interface EmptyStateProps {
  Icon: IconType;
  label: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Compact empty-state for reader side panels (annotations, bookmarks, notes):
 * a large muted icon above a title and either a one-line hint or an action
 * (e.g. a button), matching the library empty-state's tone.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ Icon, label, hint, action, className }) => (
  <div
    className={clsx(
      'flex select-none flex-col items-center justify-center gap-2 px-6 text-center',
      className,
    )}
  >
    <Icon className='text-base-content/55 mb-3' aria-hidden='true' size='8rem' />
    <p className='text-base-content text-sm font-semibold'>{label}</p>
    {hint && <p className='text-base-content/45 text-sm'>{hint}</p>}
    {action && <div className='mt-2'>{action}</div>}
  </div>
);

export default EmptyState;
