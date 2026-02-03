'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { XRayEntity, XRayEntityType } from '@/services/ai/types';

interface EntitySplitModalProps {
  entity: XRayEntity;
  isOpen: boolean;
  onClose: () => void;
  onSplit: (newName: string, newType?: XRayEntityType) => void;
}

const ENTITY_TYPES: { value: XRayEntityType; label: string }[] = [
  { value: 'character', label: 'Character' },
  { value: 'location', label: 'Location' },
  { value: 'organization', label: 'Organization' },
  { value: 'artifact', label: 'Artifact' },
  { value: 'term', label: 'Term' },
  { value: 'event', label: 'Event' },
  { value: 'concept', label: 'Concept' },
];

export const EntitySplitModal: React.FC<EntitySplitModalProps> = ({
  entity,
  isOpen,
  onClose,
  onSplit,
}) => {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<XRayEntityType | ''>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (newName.trim()) {
      onSplit(newName.trim(), newType || undefined);
      setNewName('');
      setNewType('');
      onClose();
    }
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
      <div className='bg-base-100 w-full max-w-md rounded-lg p-6 shadow-xl'>
        <h3 className='text-lg font-semibold'>Split Entity</h3>
        <p className='text-base-content/70 mt-2 text-sm'>
          Create a new entity based on &ldquo;{entity.canonicalName}&rdquo;. The original entity
          will remain unchanged.
        </p>

        <div className='mt-4 space-y-4'>
          <div>
            <label htmlFor='split-name' className='text-base-content/70 text-xs'>
              New Entity Name *
            </label>
            <input
              id='split-name'
              ref={inputRef}
              type='text'
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='Enter new entity name'
              className='input input-bordered input-sm mt-1 w-full'
            />
          </div>

          <div>
            <label htmlFor='split-type' className='text-base-content/70 text-xs'>
              Entity Type (optional)
            </label>
            <select
              id='split-type'
              value={newType}
              onChange={(e) => setNewType(e.target.value as XRayEntityType | '')}
              className='select select-bordered select-sm mt-1 w-full'
            >
              <option value=''>Same as original ({entity.type})</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            Cancel
          </button>
          <button
            className='btn btn-primary btn-sm'
            onClick={handleConfirm}
            disabled={!newName.trim()}
          >
            Split Entity
          </button>
        </div>
      </div>
    </div>
  );
};
