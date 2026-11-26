'use client';

import React, { useEffect, useState } from 'react';
import DeleteConfirmationModal from '@/app/user/components/DeleteConfirmationModal';
import { useTranslation } from '@/hooks/useTranslation';
import { useUserActions } from '@/hooks/useUserActions';

type Listener = () => void;
const listeners = new Set<Listener>();

export const openDeleteLibraryDialog = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const DeleteLibraryDialog: React.FC = () => {
  const _ = useTranslation();
  const { handleDeleteAllBooks } = useUserActions();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const listener: Listener = () => setIsOpen(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <DeleteConfirmationModal
      title={_('Delete Library Data?')}
      message={_(
        'This action cannot be undone. Every book will be removed from this device and from your Readest cloud library, along with reading progress, bookmarks, and annotations. Books you imported in place keep their original files, and books uploaded to cloud storage stay there until you remove them under Manage Storage. Other signed-in devices keep their own copies.',
      )}
      requireTypedConfirmation={false}
      onCancel={() => setIsOpen(false)}
      onConfirm={async () => {
        await handleDeleteAllBooks(
          _('All books deleted.'),
          _('Failed to delete books. Please try again later.'),
        );
        setIsOpen(false);
      }}
    />
  );
};
