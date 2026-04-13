import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdClose } from 'react-icons/md';
import {
  DEFAULT_HIGHLIGHT_COLORS,
  DefaultHighlightColor,
  HighlightColor,
  UserHighlightColor,
} from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import NumberInput from '../NumberInput';
import ColorInput from './ColorInput';

const MAX_USER_HIGHLIGHT_COLORS = 10;

interface HighlightColorsEditorProps {
  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: UserHighlightColor[];
  defaultHighlightLabels: Partial<Record<DefaultHighlightColor, string>>;
  highlightOpacity: number;
  isEink: boolean;
  onCustomHighlightColorsChange: (colors: Record<HighlightColor, string>) => void;
  onUserHighlightColorsChange: (colors: UserHighlightColor[]) => void;
  onDefaultHighlightLabelsChange: (labels: Partial<Record<DefaultHighlightColor, string>>) => void;
  onOpacityChange: (opacity: number) => void;
}

/**
 * Popover that appears on click of a color circle, allowing the user to
 * view and edit the label for that color.
 */
const LabelPopover: React.FC<{
  label: string;
  onCommit: (next: string) => void;
  onClose: () => void;
}> = ({ label, onCommit, onClose }) => {
  const _ = useTranslation();
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        commit();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== label) onCommit(trimmed);
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className='bg-base-100 border-base-300 absolute -top-9 left-1/2 z-50 -translate-x-1/2 rounded-md border px-1 py-0.5 shadow-lg'
    >
      <input
        ref={inputRef}
        type='text'
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onClose();
        }}
        placeholder={_('Name')}
        maxLength={20}
        className='bg-base-100 w-20 text-center text-xs outline-none'
      />
    </div>
  );
};

/**
 * A color circle that shows label on hover and opens a label editor on click.
 */
const ColorCircle: React.FC<{
  hex: string;
  label: string;
  highlightPreviewStyle: React.CSSProperties;
  onLabelCommit: (next: string) => void;
}> = ({ hex, label, highlightPreviewStyle, onLabelCommit }) => {
  const [editing, setEditing] = useState(false);

  return (
    <div className='relative flex flex-col items-center'>
      {editing && (
        <LabelPopover label={label} onCommit={onLabelCommit} onClose={() => setEditing(false)} />
      )}
      <div
        className='border-base-300 h-8 w-8 cursor-pointer rounded-full border-2 shadow-sm'
        title={label || undefined}
        onClick={() => setEditing(true)}
      >
        <div
          className='h-full w-full rounded-full'
          style={{ backgroundColor: hex, ...highlightPreviewStyle }}
        />
      </div>
    </div>
  );
};

const normalizeHex = (value: string) => value.trim().toLowerCase();

const HighlightColorsEditor: React.FC<HighlightColorsEditorProps> = ({
  customHighlightColors,
  userHighlightColors,
  defaultHighlightLabels,
  highlightOpacity,
  isEink,
  onCustomHighlightColorsChange,
  onUserHighlightColorsChange,
  onDefaultHighlightLabelsChange,
  onOpacityChange,
}) => {
  const _ = useTranslation();
  const [newColor, setNewColor] = useState('#808080');

  const highlightPreviewStyle: React.CSSProperties = {
    opacity: highlightOpacity,
    mixBlendMode:
      'var(--overlayer-highlight-blend-mode, normal)' as React.CSSProperties['mixBlendMode'],
  };

  const handleDefaultHexChange = (color: DefaultHighlightColor, hex: string) => {
    onCustomHighlightColorsChange({ ...customHighlightColors, [color]: hex });
  };

  const handleDefaultLabelChange = (color: DefaultHighlightColor, label: string) => {
    const next = { ...defaultHighlightLabels };
    if (label) {
      next[color] = label;
    } else {
      delete next[color];
    }
    onDefaultHighlightLabelsChange(next);
  };

  const handleUserLabelChange = (hex: string, label: string) => {
    const key = normalizeHex(hex);
    onUserHighlightColorsChange(
      userHighlightColors.map((entry) =>
        entry.hex === key ? { ...entry, label: label || undefined } : entry,
      ),
    );
  };

  const handleAddUserColor = () => {
    if (userHighlightColors.length >= MAX_USER_HIGHLIGHT_COLORS) return;
    const hex = normalizeHex(newColor);
    if (!hex.startsWith('#')) return;
    if (userHighlightColors.some((entry) => entry.hex === hex)) return;
    onUserHighlightColorsChange([...userHighlightColors, { hex }]);
  };

  const handleDeleteUserColor = (hex: string) => {
    const key = normalizeHex(hex);
    onUserHighlightColorsChange(userHighlightColors.filter((entry) => entry.hex !== key));
  };

  const handleUserHexChange = (oldHex: string, newHex: string) => {
    const oldKey = normalizeHex(oldHex);
    const newKey = normalizeHex(newHex);
    if (oldKey === newKey) return;
    if (userHighlightColors.some((entry) => entry.hex === newKey)) return;
    onUserHighlightColorsChange(
      userHighlightColors.map((entry) =>
        entry.hex === oldKey ? { ...entry, hex: newKey } : entry,
      ),
    );
  };

  const isDuplicateNewColor = userHighlightColors.some(
    (entry) => entry.hex === normalizeHex(newColor),
  );

  return (
    <div>
      <h2 className='mb-2 font-medium'>{_('Highlight Colors')}</h2>
      <div className='card border-base-200 bg-base-100 overflow-visible border shadow'>
        <div className='grid grid-cols-3 gap-3 p-4 sm:grid-cols-5'>
          {DEFAULT_HIGHLIGHT_COLORS.map((color, index, array) => {
            const position = index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
            return (
              <div key={color} className='flex flex-col items-center gap-2'>
                <ColorCircle
                  hex={customHighlightColors[color]!}
                  label={defaultHighlightLabels[color] ?? ''}
                  highlightPreviewStyle={highlightPreviewStyle}
                  onLabelCommit={(next) => handleDefaultLabelChange(color, next)}
                />
                <ColorInput
                  label=''
                  value={customHighlightColors[color]!}
                  compact={true}
                  pickerPosition={position}
                  onChange={(value: string) => handleDefaultHexChange(color, value)}
                />
              </div>
            );
          })}
        </div>

        <div className='border-base-200 border-t p-4'>
          <div
            className={clsx(
              'flex items-center justify-between',
              userHighlightColors.length > 0 && 'mb-4',
            )}
          >
            <span className='font-normal'>
              {_('Custom Colors')} ({userHighlightColors.length}/{MAX_USER_HIGHLIGHT_COLORS})
            </span>
            <div className='flex items-center gap-2'>
              <div className='border-base-300 h-6 w-6 rounded-full border-2 shadow-sm'>
                <div
                  className='h-full w-full rounded-full'
                  style={{ backgroundColor: newColor, ...highlightPreviewStyle }}
                />
              </div>
              <ColorInput
                label=''
                value={newColor}
                compact={true}
                pickerPosition='right'
                onChange={setNewColor}
              />
              <button
                onClick={handleAddUserColor}
                disabled={
                  isDuplicateNewColor || userHighlightColors.length >= MAX_USER_HIGHLIGHT_COLORS
                }
                className='btn btn-ghost btn-sm gap-1 bg-transparent disabled:bg-transparent disabled:opacity-40'
              >
                <span className='text-xs'>{_('Add')}</span>
              </button>
            </div>
          </div>

          {userHighlightColors.length > 0 && (
            <div className='grid grid-cols-3 gap-3 sm:grid-cols-5'>
              {userHighlightColors.map(({ hex, label }, index) => (
                <div key={index} className='group relative flex flex-col items-center gap-2'>
                  <ColorCircle
                    hex={hex}
                    label={label ?? ''}
                    highlightPreviewStyle={highlightPreviewStyle}
                    onLabelCommit={(next) => handleUserLabelChange(hex, next)}
                  />
                  <ColorInput
                    label=''
                    value={hex}
                    compact={true}
                    pickerPosition={index === 0 ? 'left' : 'center'}
                    onChange={(value: string) => handleUserHexChange(hex, value)}
                  />
                  <button
                    onClick={() => handleDeleteUserColor(hex)}
                    className='absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100'
                    title={_('Delete')}
                  >
                    <MdClose size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='border-base-200 border-t'>
          <NumberInput
            label={_('Opacity')}
            value={highlightOpacity}
            onChange={onOpacityChange}
            disabled={isEink}
            min={0}
            max={1}
            step={0.1}
          />
        </div>
      </div>
    </div>
  );
};

export default HighlightColorsEditor;
