import clsx from 'clsx';
import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import Alert from './Alert';

const ToggleRow: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  destructive?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, destructive = false, onChange }) => {
  const danger = checked && destructive;
  return (
    <label
      className={clsx(
        'eink-bordered flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
        danger
          ? 'not-eink:border-error/40 not-eink:bg-error/10'
          : 'not-eink:border-base-content/10 not-eink:bg-base-100/60',
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className={clsx('text-sm font-medium', danger && 'not-eink:text-error')}>
          {label}
        </span>
        <span className='text-neutral-content text-xs'>{description}</span>
      </div>
      <input
        type='checkbox'
        className={clsx('toggle toggle-sm shrink-0', danger && 'not-eink:toggle-error')}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        // Alert confirms on any Enter. On a focused toggle, Enter flips it
        // instead, so it can't run a delete the toggle was meant to change.
        // The capture phase runs before Alert's listener on the surface.
        onKeyDownCapture={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          onChange(!checked);
        }}
        aria-label={label}
      />
    </label>
  );
};

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
 *
 * The bulk delete also offers "Remove from Device Only" (#7318) for the
 * `deviceOnlyCount` selected books that have a cloud copy. Turning it on
 * replaces the delete with `onConfirmDeviceOnly`, which keeps every book in
 * the library, so the delete message and purge toggle are hidden while it is
 * on.
 */
const DeleteConfirmAlert: React.FC<{
  title: string;
  message: string;
  showPurgeToggle?: boolean;
  deviceOnlyCount?: number;
  onCancel: () => void;
  onConfirm: (purgeData: boolean) => void;
  onConfirmDeviceOnly?: () => void;
}> = ({
  title,
  message,
  showPurgeToggle = false,
  deviceOnlyCount = 0,
  onCancel,
  onConfirm,
  onConfirmDeviceOnly,
}) => {
  const _ = useTranslation();
  const [purgeData, setPurgeData] = useState(false);
  const [deviceOnly, setDeviceOnly] = useState(false);
  const showDeviceOnlyToggle = !!onConfirmDeviceOnly && deviceOnlyCount > 0;

  return (
    <Alert
      title={title}
      // The toggle's own text says what a device-only removal does.
      message={deviceOnly ? undefined : message}
      confirmLabel={deviceOnly ? _('Remove') : purgeData ? _('Purge & Delete') : _('Delete')}
      confirmButtonClassName={purgeData && !deviceOnly ? 'btn-error' : 'btn-warning'}
      onCancel={onCancel}
      onConfirm={() => (deviceOnly ? onConfirmDeviceOnly?.() : onConfirm(purgeData))}
    >
      {showDeviceOnlyToggle && (
        <ToggleRow
          label={_('Remove from Device Only')}
          description={_(
            'Remove the downloaded files of {{count}} book(s) and keep them in the cloud.',
            { count: deviceOnlyCount },
          )}
          checked={deviceOnly}
          onChange={setDeviceOnly}
        />
      )}
      {showPurgeToggle && !deviceOnly && (
        <ToggleRow
          label={_('Purge all reading data')}
          description={
            purgeData
              ? _(
                  'This permanently erases reading progress, notes, and bookmarks. This cannot be undone.',
                )
              : _('Also erase reading progress, notes, and bookmarks.')
          }
          checked={purgeData}
          destructive
          onChange={setPurgeData}
        />
      )}
    </Alert>
  );
};

export default DeleteConfirmAlert;
