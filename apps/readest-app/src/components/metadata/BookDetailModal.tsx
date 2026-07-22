import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { getBookWithUpdatedMetadata } from '@/utils/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useMetadataEdit } from './useMetadataEdit';
import { DeleteAction } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { isWebAppPlatform } from '@/services/environment';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import Dialog from '@/components/Dialog';
import BookDetailView from './BookDetailView';
import BookDetailEdit from './BookDetailEdit';
import SourceSelector from './SourceSelector';
import Spinner from '../Spinner';

interface BookDetailModalProps {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
  handleBookDownload?: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  handleBookUpload?: (book: Book) => void;
  handleBookDelete?: (book: Book) => void;
  handleBookDeleteCloudBackup?: (book: Book) => void;
  handleBookDeleteLocalCopy?: (book: Book) => void;
  handleBookPurge?: (book: Book) => void;
  handleBookMetadataUpdate?: (book: Book, updatedMetadata: BookMetadata) => void;
}

// Purge is no longer a standalone menu action — it is an opt-in toggle on the
// standard ('both') delete confirmation, so the menu only triggers these three.
type DeleteMenuAction = Exclude<DeleteAction, 'purge'>;

interface DeleteConfig {
  title: string;
  message: string;
  handler?: (book: Book) => void;
  showPurgeToggle?: boolean;
}

const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  isOpen,
  onClose,
  handleBookDownload,
  handleBookUpload,
  handleBookDelete,
  handleBookDeleteCloudBackup,
  handleBookDeleteLocalCopy,
  handleBookPurge,
  handleBookMetadataUpdate,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { safeAreaInsets } = useThemeStore();
  const [activeDeleteAction, setActiveDeleteAction] = useState<DeleteMenuAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookMetadata | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  // The parent owns the `book` prop and does not re-pass it after a metadata
  // save, so the details view tracks the saved book locally to refresh its
  // cover/title/author immediately (otherwise it shows the stale prop).
  const [displayBook, setDisplayBook] = useState<Book>(book);

  // Initialize metadata edit hook
  const {
    editedMeta,
    fieldSources,
    lockedFields,
    fieldErrors,
    searchLoading,
    showSourceSelection,
    availableSources,
    handleFieldChange,
    handleToggleFieldLock,
    handleLockAll,
    handleUnlockAll,
    handleAutoRetrieve,
    handleSourceSelection,
    handleCloseSourceSelection,
    resetToOriginal,
  } = useMetadataEdit(bookMeta);

  const deleteConfigs: Record<DeleteMenuAction, DeleteConfig> = {
    both: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the selected book?'),
      handler: handleBookDelete,
      showPurgeToggle: !!handleBookPurge,
    },
    cloud: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the cloud backup of the selected book?'),
      handler: handleBookDeleteCloudBackup,
    },
    local: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the local copy of the selected book?'),
      handler: handleBookDeleteLocalCopy,
    },
  };

  useEffect(() => {
    const fetchBookDetails = async () => {
      const appService = await envConfig.getAppService();
      try {
        let details = book.metadata || null;
        if (!details && book.downloadedAt) {
          details = await appService.fetchBookDetails(book);
        }
        setBookMeta(details);
        const size = await appService.getBookFileSize(book);
        setFileSize(size);
      } finally {
      }
    };
    fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  useEffect(() => {
    setDisplayBook(book);
  }, [book]);

  const handleClose = () => {
    setBookMeta(null);
    setEditMode(false);
    setActiveDeleteAction(null);
    onClose();
  };

  const handleEditMetadata = () => {
    setEditMode(true);
  };

  const handleCancelEdit = () => {
    resetToOriginal();
    setEditMode(false);
  };

  const handleSaveMetadata = () => {
    if (editedMeta && handleBookMetadataUpdate) {
      setBookMeta({ ...editedMeta });
      // Capture the updated book before handleBookMetadataUpdate clears the
      // temporary cover fields on editedMeta, so the view refreshes its cover.
      setDisplayBook(getBookWithUpdatedMetadata(book, editedMeta));
      handleBookMetadataUpdate(book, editedMeta);
      setEditMode(false);
    }
  };

  const handleDeleteAction = (action: DeleteMenuAction) => {
    setActiveDeleteAction(action);
  };

  const confirmDeleteAction = async (purgeData: boolean) => {
    if (!activeDeleteAction) return;

    const config = deleteConfigs[activeDeleteAction];
    handleClose();

    // The standard "Cloud & Device" delete escalates to a full purge when the
    // user opts in via the confirmation toggle. The cloud-only / device-only
    // variants keep the library entry, so purging reading data does not apply.
    if (activeDeleteAction === 'both' && purgeData && handleBookPurge) {
      handleBookPurge(book);
    } else if (config.handler) {
      config.handler(book);
    }
  };

  const cancelDeleteAction = () => {
    setActiveDeleteAction(null);
  };

  const handleDelete = () => handleDeleteAction('both');
  const handleDeleteCloudBackup = () => handleDeleteAction('cloud');
  const handleDeleteLocalCopy = () => handleDeleteAction('local');

  const handleShare = () => {
    // Close this modal first, then hand off to the share dialog hosted by
    // Bookshelf (it owns the login gate + ShareBookDialog). Mirrors how the
    // bookshelf context menu dispatches the same event.
    handleClose();
    eventDispatcher.dispatch('show-share-dialog', { book });
  };

  const handleBookExport = async () => {
    setIsLoading(true);
    setTimeout(async () => {
      const success = await appService?.exportBook(book);
      setIsLoading(false);
      if (!isWebAppPlatform()) {
        eventDispatcher.dispatch('toast', {
          type: success ? 'info' : 'error',
          message: success ? _('Book exported successfully.') : _('Failed to export the book.'),
        });
      }
    }, 0);
  };

  const handleRedownload = async () => {
    handleClose();
    if (handleBookDownload) {
      handleBookDownload(book, { redownload: true, queued: false });
    }
  };

  const handleReupload = async () => {
    handleClose();
    if (handleBookUpload) {
      handleBookUpload(book);
    }
  };

  // Sharing uploads the book to the Readest backend and mints a public link, so
  // it needs a signed-in user and a resolvable on-disk file. `fileSize` is only
  // non-null when getBookFileSize could actually open the local file.
  const shareEnabled = !!user && fileSize !== null;

  const currentDeleteConfig = activeDeleteAction ? deleteConfigs[activeDeleteAction] : null;

  return (
    <>
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <Dialog
          title={editMode ? _('Edit Metadata') : _('Book Details')}
          isOpen={isOpen}
          onClose={handleClose}
          boxClassName={clsx(
            editMode ? 'sm:min-w-[600px] sm:max-w-[600px]' : 'sm:min-w-[480px] sm:max-w-[480px]',
            'sm:h-auto sm:max-h-[90%]',
          )}
          contentClassName='!px-6 !py-4'
        >
          <div className='flex w-full select-text items-start justify-center'>
            {editMode && bookMeta ? (
              <BookDetailEdit
                book={book}
                metadata={editedMeta}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                searchLoading={searchLoading}
                onFieldChange={handleFieldChange}
                onToggleFieldLock={handleToggleFieldLock}
                onAutoRetrieve={handleAutoRetrieve}
                onLockAll={handleLockAll}
                onUnlockAll={handleUnlockAll}
                onCancel={handleCancelEdit}
                onReset={resetToOriginal}
                onSave={handleSaveMetadata}
              />
            ) : (
              <BookDetailView
                book={displayBook}
                metadata={bookMeta}
                fileSize={fileSize}
                shareEnabled={shareEnabled}
                onEdit={handleBookMetadataUpdate ? handleEditMetadata : undefined}
                onDelete={handleBookDelete ? handleDelete : undefined}
                onDeleteCloudBackup={
                  handleBookDeleteCloudBackup ? handleDeleteCloudBackup : undefined
                }
                onDeleteLocalCopy={handleBookDeleteLocalCopy ? handleDeleteLocalCopy : undefined}
                onDownload={handleBookDownload ? handleRedownload : undefined}
                onUpload={handleBookUpload ? handleReupload : undefined}
                onShare={handleShare}
                onExport={handleBookExport}
              />
            )}
          </div>
        </Dialog>

        {/* Source Selection Modal */}
        {showSourceSelection && (
          <SourceSelector
            sources={availableSources}
            isOpen={showSourceSelection}
            onSelect={handleSourceSelection}
            onClose={handleCloseSourceSelection}
          />
        )}

        {isLoading && (
          <div className='fixed inset-0 z-50 flex items-center justify-center'>
            <Spinner loading />
          </div>
        )}

        {activeDeleteAction && currentDeleteConfig && (
          <div
            className={clsx('fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
            style={{
              paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px`,
            }}
          >
            <DeleteConfirmAlert
              title={currentDeleteConfig.title}
              message={currentDeleteConfig.message}
              showPurgeToggle={currentDeleteConfig.showPurgeToggle}
              onCancel={cancelDeleteAction}
              onConfirm={confirmDeleteAction}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default BookDetailModal;
