import React from 'react';
import Alert from '@/components/Alert';
import ModalPortal from '@/components/ModalPortal';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { StatBook } from '@/types/statistics';
import { eventDispatcher } from '@/utils/event';

/** A change to the statistics entries (#7494). */
export type BookStatsAction =
  | { type: 'delete'; book: StatBook }
  | { type: 'merge'; source: StatBook; target: StatBook };

interface BookStatsAlertProps {
  db: StatisticsDb;
  action: BookStatsAction;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Confirms, then deletes a book's reading statistics or merges one entry into
 * another: on every device when stats sync is on, otherwise on this one.
 */
const BookStatsAlert: React.FC<BookStatsAlertProps> = ({ db, action, onClose, onDone }) => {
  const _ = useTranslation();
  const { user } = useAuth();
  const synced = !!user && isSyncCategoryEnabled('stats');
  const merge = action.type === 'merge';

  const handleConfirm = async () => {
    try {
      // Loaded here so the menus that import the stats dialog don't pull the
      // sync client (and its API base URL) into their module graph.
      const [{ SyncClient }, sync] = await Promise.all([
        import('@/libs/sync'),
        import('@/services/statistics/statsSync'),
      ]);
      const client = synced ? new SyncClient() : null;
      if (action.type === 'merge') {
        await sync.mergeBookStats(db, client, action.source, action.target);
      } else {
        await sync.deleteBookStats(db, client, action.book);
      }
      onDone();
    } catch (err) {
      console.error('Failed to change reading statistics:', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: merge
          ? _('Failed to merge reading statistics')
          : _('Failed to delete reading statistics'),
      });
    }
    onClose();
  };

  return (
    <ModalPortal>
      {action.type === 'merge' ? (
        <Alert
          title={_('Merge “{{source}}” into “{{target}}”?', {
            source: action.source.title,
            target: action.target.title,
          })}
          message={
            synced
              ? _(
                  'Its reading time moves to the other book on all your devices. This can’t be undone.',
                )
              : _('Its reading time moves to the other book on this device. This can’t be undone.')
          }
          confirmLabel={_('Merge')}
          confirmButtonClassName='btn-contrast'
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      ) : (
        <Alert
          title={_('Delete the reading statistics of “{{title}}”?', { title: action.book.title })}
          message={
            synced
              ? _('Its reading time is removed from all your devices. This can’t be undone.')
              : _('Its reading time is removed from this device. This can’t be undone.')
          }
          confirmLabel={_('Delete')}
          confirmButtonClassName='btn-error'
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      )}
    </ModalPortal>
  );
};

export default BookStatsAlert;
