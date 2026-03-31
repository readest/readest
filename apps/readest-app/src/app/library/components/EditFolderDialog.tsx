'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { FiX } from 'react-icons/fi';

interface EditFolderDialogProps {
  folderPath: string;
  initialColor: string;
  onSave: (name: string, color: string) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '', // No color (default)
  '#ef4444', // Red
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#6b7280', // Gray
  '#78350f', // Brown
];

export function EditFolderDialog({ folderPath, initialColor, onSave, onClose }: EditFolderDialogProps) {
  const _ = useTranslation();
  const folderName = folderPath.split('/').pop() || folderPath;
  const [name, setName] = useState(folderName);
  const [color, setColor] = useState(initialColor);
  const [showCustomColor, setShowCustomColor] = useState(false);
  const [customColor, setCustomColor] = useState(initialColor);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), color);
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
          <h2 className="text-xl font-bold">{_('Edit Folder')}</h2>
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={_('Enter folder name')}
            autoFocus
          />
        </div>

        <div className="mb-4">
          <label className="label">
            <span className="label-text">{_('Folder Color')}</span>
            <span className="label-text-alt">{_('Optional')}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c || 'default'}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  color === c ? 'border-base-content' : 'border-transparent'
                }`}
                style={{ backgroundColor: c || 'transparent' }}
                onClick={() => {
                  setColor(c);
                  setShowCustomColor(false);
                }}
                title={c || _('Default')}
              >
                {!c && (
                  <span className="flex h-full w-full items-center justify-center text-xs text-base-content/50">
                    ∅
                  </span>
                )}
              </button>
            ))}
            {/* Custom color button */}
            <button
              className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                showCustomColor ? 'border-base-content' : 'border-transparent'
              }`}
              style={{ background: 'linear-gradient(135deg, #ef4444 25%, #3b82f6 25%, #3b82f6 50%, #22c55e 50%, #22c55e 75%, #eab308 75%)' }}
              onClick={() => setShowCustomColor(!showCustomColor)}
              title={_('Custom color')}
            >
              <span className="flex h-full w-full items-center justify-center text-xs text-white drop-shadow">
                +
              </span>
            </button>
          </div>
          
          {/* Custom color picker */}
          {showCustomColor && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                className="h-8 w-12 cursor-pointer rounded border border-base-300"
                value={customColor || '#3b82f6'}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setColor(e.target.value);
                }}
              />
              <span className="text-sm text-base-content/70">{customColor || _('Select color')}</span>
            </div>
          )}
          
          {color && (
            <div className="mt-2 flex items-center gap-2">
              <div
                className="h-4 w-4 rounded"
                style={{ backgroundColor: color }}
              />
              <span className="text-sm text-base-content/70">{color}</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  setColor('');
                  setShowCustomColor(false);
                }}
              >
                {_('Clear')}
              </button>
            </div>
          )}
        </div>

        <div className="mb-4 rounded bg-base-200 p-3">
          <p className="text-sm text-base-content/70">
            <span className="font-medium">{_('Path')}:</span>{' '}
            <span className="text-primary">{folderPath}</span>
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            {_('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            {_('Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
}
