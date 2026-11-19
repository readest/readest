import React from 'react';
import Alert from '@/components/Alert';
import ModalPortal from '@/components/ModalPortal';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { BookStats } from '@/types/statistics';
import { eventDispatcher } from '@/utils/event';

interface DeleteBookStatsAlertProps {
  db: StatisticsDb;
  book: BookStats;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Confirms, then deletes a book's reading statistics (#7494): on every device
 * when stats sync is on, otherwise on this one.
 */
const DeleteBookStatsAlert: React.FC<DeleteBookStatsAlertProps> = ({
  db,
  book,
  onClose,
  onDeleted,
}) => {
  const _ = useTranslation();
  const { user } = useAuth();
  const synced = !!user && isSyncCategoryEnabled('stats');

  const handleConfirm = async () => {
    try {
      // Loaded here so the menus that import the stats dialog don't pull the
      // sync client (and its API base URL) into their module graph.
      const [{ SyncClient }, { deleteBookStats }] = await Promise.all([
        import('@/libs/sync'),
        import('@/services/statistics/statsSync'),
      ]);
      await deleteBookStats(db, synced ? new SyncClient() : null, {
        bookMd5: book.md5,
        title: book.title,
        authors: book.authors,
      });
      onDeleted();
    } catch (err) {
      console.error('Failed to delete reading statistics:', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to delete reading statistics'),
      });
    }
    onClose();
  };

  return (
    <ModalPortal>
      <Alert
        title={_('Delete the reading statistics of “{{title}}”?', { title: book.title })}
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
    </ModalPortal>
  );
};

export default DeleteBookStatsAlert;
