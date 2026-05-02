import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { Book, AudiobookConfig } from '@/types/book';
import { BookConfig } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useMetadataEdit } from './useMetadataEdit';
import { DeleteAction } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { isWebAppPlatform } from '@/services/environment';
import { getFilename } from '@/utils/path';
import Alert from '@/components/Alert';
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
  handleBookMetadataUpdate?: (book: Book, updatedMetadata: BookMetadata) => void;
}

interface DeleteConfig {
  title: string;
  message: string;
  handler?: (book: Book) => void;
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
  handleBookMetadataUpdate,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { settings } = useSettingsStore();
  const { selectFiles } = useFileSelector(appService, _);
  const [activeDeleteAction, setActiveDeleteAction] = useState<DeleteAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookMetadata | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [audiobookConfig, setAudiobookConfig] = useState<AudiobookConfig | undefined>(undefined);
  const [bookConfig, setBookConfig] = useState<BookConfig | null>(null);

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

  const deleteConfigs: Record<DeleteAction, DeleteConfig> = {
    both: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the selected book?'),
      handler: handleBookDelete,
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

        // Load book config to read existing audiobook attachment
        const config = await appService.loadBookConfig(book, settings);
        setBookConfig(config);
        setAudiobookConfig(config.audiobook);
      } finally {
      }
    };
    fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const saveAudiobookConfig = async (updatedAudiobook?: AudiobookConfig) => {
    if (!appService || !bookConfig) return;
    const updatedConfig: BookConfig = {
      ...bookConfig,
      audiobook: updatedAudiobook,
      updatedAt: Date.now(),
    };
    try {
      await appService.saveBookConfig(book, updatedConfig, settings);
      setBookConfig(updatedConfig);
      setAudiobookConfig(updatedAudiobook);
    } catch (error) {
      console.error('Failed to save audiobook config:', error);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to save audiobook settings'),
        type: 'error',
      });
    }
  };

  const handleAddAudiobook = async () => {
    const result = await selectFiles({ type: 'audio', multiple: false });
    if (result.error || result.files.length === 0) return;
    const file = result.files[0]!;
    const filePath = file.path ?? file.file?.name ?? '';
    const fileName = file.path ? getFilename(file.path) : (file.file?.name ?? filePath);
    await saveAudiobookConfig({
      filePath,
      fileName,
      addedAt: Date.now(),
      syncStatus: 'none',
    });
  };

  const handleReplaceAudiobook = async () => {
    const result = await selectFiles({ type: 'audio', multiple: false });
    if (result.error || result.files.length === 0) return;
    const file = result.files[0]!;
    const filePath = file.path ?? file.file?.name ?? '';
    const fileName = file.path ? getFilename(file.path) : (file.file?.name ?? filePath);
    await saveAudiobookConfig({
      filePath,
      fileName,
      addedAt: Date.now(),
      syncStatus: 'none',
    });
  };

  const handleRemoveAudiobook = async () => {
    await saveAudiobookConfig(undefined);
  };

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
      handleBookMetadataUpdate(book, editedMeta);
      setEditMode(false);
    }
  };

  const handleDeleteAction = (action: DeleteAction) => {
    setActiveDeleteAction(action);
  };

  const confirmDeleteAction = async () => {
    if (!activeDeleteAction) return;

    const config = deleteConfigs[activeDeleteAction];
    handleClose();

    if (config.handler) {
      config.handler(book);
    }
  };

  const cancelDeleteAction = () => {
    setActiveDeleteAction(null);
  };

  const handleDelete = () => handleDeleteAction('both');
  const handleDeleteCloudBackup = () => handleDeleteAction('cloud');
  const handleDeleteLocalCopy = () => handleDeleteAction('local');

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
            // Citadel dark academia panel
            'book-detail-citadel',
            '!bg-[radial-gradient(ellipse_at_top,rgba(22,16,13,0.99),rgba(11,8,7,0.98))]',
            '!border !border-[rgba(185,133,44,0.18)]',
            '!shadow-[0_24px_64px_rgba(0,0,0,0.52),0_0_2px_rgba(201,162,39,0.14)]',
            'sm:!rounded-[22px]',
          )}
          contentClassName='!px-0 !py-0'
          bgClassName='!bg-black/60'
        >
          <div className='flex w-full select-text items-start justify-center px-6 py-4'>
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
                book={book}
                metadata={bookMeta}
                fileSize={fileSize}
                audiobookConfig={audiobookConfig}
                onAddAudiobook={handleAddAudiobook}
                onReplaceAudiobook={handleReplaceAudiobook}
                onRemoveAudiobook={handleRemoveAudiobook}
                onEdit={handleBookMetadataUpdate ? handleEditMetadata : undefined}
                onDelete={handleBookDelete ? handleDelete : undefined}
                onDeleteCloudBackup={
                  handleBookDeleteCloudBackup ? handleDeleteCloudBackup : undefined
                }
                onDeleteLocalCopy={handleBookDeleteLocalCopy ? handleDeleteLocalCopy : undefined}
                onDownload={handleBookDownload ? handleRedownload : undefined}
                onUpload={handleBookUpload ? handleReupload : undefined}
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
            <Alert
              title={currentDeleteConfig.title}
              message={currentDeleteConfig.message}
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
