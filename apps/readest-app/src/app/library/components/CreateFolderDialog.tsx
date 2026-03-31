'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { FiX } from 'react-icons/fi';

interface CreateFolderDialogProps {
  parentPath: string;
  existingFolders: Set<string>;
  onSave: (folderPath: string) => void;
  onClose: () => void;
}

export function CreateFolderDialog({ parentPath, existingFolders, onSave, onClose }: CreateFolderDialogProps) {
  const _ = useTranslation();
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setError(_('Please enter a folder name'));
      return;
    }

    const newPath = parentPath ? `${parentPath}/${trimmedName}` : trimmedName;
    
    if (existingFolders.has(newPath)) {
      setError(_('Folder already exists'));
      return;
    }

    onSave(newPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-base-100 w-full max-w-md rounded-lg p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{_('Create Folder')}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>

        <div className="mb-4">
          <label className="label">
            <span className="label-text">{_('Folder Name')}</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={folderName}
            onChange={(e) => {
              setFolderName(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={_('Enter folder name')}
            autoFocus
          />
          {error && (
            <p className="text-error mt-1 text-sm">{error}</p>
          )}
        </div>

        {parentPath && (
          <div className="mb-4 rounded bg-base-200 p-3">
            <p className="text-sm text-base-content/70">
              <span className="font-medium">{_('Parent Folder')}:</span>{' '}
              <span className="text-primary">{parentPath}</span>
            </p>
            <p className="text-sm text-base-content/70">
              <span className="font-medium">{_('New Path')}:</span>{' '}
              <span className="text-primary">{parentPath}/{folderName || '...'}</span>
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            {_('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            {_('Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
