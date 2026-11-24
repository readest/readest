import React from 'react';
import Alert from '@/components/Alert';
import ModalPortal from '@/components/ModalPortal';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { StatBook } from '@/types/statistics';
import { eventDispatcher } from '@/utils/event';

/** A change to the statistics entries (#7494), of one entry or several (#7812). */
export type BookStatsAction =
  | { type: 'delete'; books: StatBook[] }
  | { type: 'merge'; sources: StatBook[]; target: StatBook };

interface BookStatsAlertProps {
  db: StatisticsDb;
  action: BookStatsAction;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Confirms, then deletes books' reading statistics or merges entries into
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
        await sync.mergeBookStats(db, client, action.sources, action.target);
      } else {
        await sync.deleteBookStats(db, client, action.books);
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

  if (action.type === 'merge') {
    const { sources, target } = action;
    const many = sources.length > 1;
    let message = _(
      'Its reading time moves to the other book on this device. This can’t be undone.',
    );
    if (many && synced) {
      message = _(
        'Their reading time moves to the other book on all your devices. This can’t be undone.',
      );
    } else if (many) {
      message = _(
        'Their reading time moves to the other book on this device. This can’t be undone.',
      );
    } else if (synced) {
      message = _(
        'Its reading time moves to the other book on all your devices. This can’t be undone.',
      );
    }
    return (
      <ModalPortal>
        <Alert
          title={
            many
              ? _('Merge {{count}} entries into “{{target}}”?', {
                  count: sources.length,
                  target: target.title,
                })
              : _('Merge “{{source}}” into “{{target}}”?', {
                  source: sources[0]!.title,
                  target: target.title,
                })
          }
          message={message}
          confirmLabel={_('Merge')}
          confirmButtonClassName='btn-contrast'
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      </ModalPortal>
    );
  }

  const { books } = action;
  const many = books.length > 1;
  let message = _('Its reading time is removed from this device. This can’t be undone.');
  if (many && synced) {
    message = _('Their reading time is removed from all your devices. This can’t be undone.');
  } else if (many) {
    message = _('Their reading time is removed from this device. This can’t be undone.');
  } else if (synced) {
    message = _('Its reading time is removed from all your devices. This can’t be undone.');
  }
  return (
    <ModalPortal>
      <Alert
        title={
          many
            ? _('Delete the reading statistics of {{count}} books?', { count: books.length })
            : _('Delete the reading statistics of “{{title}}”?', { title: books[0]!.title })
        }
        message={message}
        confirmLabel={_('Delete')}
        confirmButtonClassName='btn-error'
        onCancel={onClose}
        onConfirm={handleConfirm}
      />
    </ModalPortal>
  );
};

export default BookStatsAlert;
