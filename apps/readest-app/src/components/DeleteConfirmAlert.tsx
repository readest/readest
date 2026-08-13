import clsx from 'clsx';
import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import Alert from './Alert';

/**
 * Delete confirmation alert with an optional, opt-in "purge all reading data"
 * toggle. Used by both the single-book delete (BookDetailModal) and the
 * bulk/multi-select delete (Bookshelf), so the same purge-on-delete affordance
 * covers every standard delete path (issue #4698).
 *
 * The toggle defaults to OFF and is ephemeral — it resets every time the alert
 * mounts. When turned ON the confirm action escalates to a destructive purge
 * (wipes the book's reading progress, notes, and bookmarks), signalled by the
 * red button + relabel so the irreversible choice reads clearly even on e-ink
 * where colour alone is not enough.
 */
const DeleteConfirmAlert: React.FC<{
  title: string;
  message: string;
  showPurgeToggle?: boolean;
  onCancel: () => void;
  onConfirm: (purgeData: boolean) => void;
}> = ({ title, message, showPurgeToggle = false, onCancel, onConfirm }) => {
  const _ = useTranslation();
  const [purgeData, setPurgeData] = useState(false);

  return (
    <Alert
      title={title}
      message={message}
      confirmLabel={purgeData ? _('Purge & Delete') : _('Delete')}
      confirmButtonClassName={purgeData ? 'btn-error' : 'btn-warning'}
      onCancel={onCancel}
      onConfirm={() => onConfirm(purgeData)}
    >
      {showPurgeToggle && (
        <label
          className={clsx(
            'eink-bordered flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
            purgeData
              ? 'not-eink:border-error/40 not-eink:bg-error/10'
              : 'not-eink:border-base-content/10 not-eink:bg-base-100/60',
          )}
        >
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <span className={clsx('text-sm font-medium', purgeData && 'not-eink:text-error')}>
              {_('Purge all reading data')}
            </span>
            <span className='text-neutral-content text-xs'>
              {purgeData
                ? _(
                    'This permanently erases reading progress, notes, and bookmarks. This cannot be undone.',
                  )
                : _('Also erase reading progress, notes, and bookmarks.')}
            </span>
          </div>
          <input
            type='checkbox'
            className={clsx('toggle toggle-sm shrink-0', purgeData && 'not-eink:toggle-error')}
            checked={purgeData}
            onChange={(e) => setPurgeData(e.target.checked)}
            aria-label={_('Purge all reading data')}
          />
        </label>
      )}
    </Alert>
  );
};

export default DeleteConfirmAlert;
