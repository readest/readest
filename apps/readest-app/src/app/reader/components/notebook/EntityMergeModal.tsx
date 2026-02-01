'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import type { XRayEntity } from '@/services/ai/types';

interface EntityMergeModalProps {
  entities: XRayEntity[];
  sourceEntity: XRayEntity;
  isOpen: boolean;
  onClose: () => void;
  onMerge: (targetEntityIds: string[]) => void;
}

export const EntityMergeModal: React.FC<EntityMergeModalProps> = ({
  entities,
  sourceEntity,
  isOpen,
  onClose,
  onMerge,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const availableEntities = entities.filter(
    (e) => e.id !== sourceEntity.id && e.type === sourceEntity.type,
  );

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleConfirm = () => {
    if (selectedIds.length > 0) {
      onMerge(selectedIds);
      setSelectedIds([]);
      setReason('');
      onClose();
    }
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
      <div className='bg-base-100 w-full max-w-md rounded-lg p-6 shadow-xl'>
        <h3 className='text-lg font-semibold'>Merge &ldquo;{sourceEntity.canonicalName}&rdquo;</h3>
        <p className='text-base-content/70 mt-2 text-sm'>
          Select entities to merge with this one. They will be combined into a single entity.
        </p>

        <div className='border-base-300 mt-4 max-h-60 overflow-y-auto rounded-md border'>
          {availableEntities.length === 0 ? (
            <p className='text-base-content/60 p-4 text-sm'>
              No other {sourceEntity.type}s available to merge
            </p>
          ) : (
            availableEntities.map((entity) => (
              <div
                key={entity.id}
                className='hover:bg-base-200 flex items-center gap-3 border-b p-3 last:border-b-0'
              >
                <input
                  id={`merge-entity-${entity.id}`}
                  type='checkbox'
                  checked={selectedIds.includes(entity.id)}
                  onChange={() => handleToggle(entity.id)}
                  className='checkbox checkbox-sm'
                />
                <label
                  htmlFor={`merge-entity-${entity.id}`}
                  className='flex flex-1 cursor-pointer flex-col'
                >
                  <span className='text-sm font-medium'>{entity.canonicalName}</span>
                  <span className='text-base-content/60 text-xs'>
                    {entity.aliases.slice(0, 2).join(', ')}
                  </span>
                </label>
              </div>
            ))
          )}
        </div>

        <div className='mt-4'>
          <label htmlFor='merge-reason' className='text-base-content/70 text-xs'>
            Reason (optional)
          </label>
          <input
            id='merge-reason'
            type='text'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder='Why are you merging these entities?'
            className='input input-bordered input-sm mt-1 w-full'
          />
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            Cancel
          </button>
          <button
            className={clsx('btn btn-primary btn-sm', selectedIds.length === 0 && 'btn-disabled')}
            onClick={handleConfirm}
            disabled={selectedIds.length === 0}
          >
            Merge {selectedIds.length > 0 && `(${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};
