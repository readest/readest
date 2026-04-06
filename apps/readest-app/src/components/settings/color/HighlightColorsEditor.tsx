import React, { useEffect, useState } from 'react';
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
 * Text input that commits on blur instead of on every keystroke, so we don't
 * thrash the settings store while the user is typing a label.
 */
const LabelInput: React.FC<{
  label: string;
  onCommit: (next: string) => void;
  placeholder: string;
  className: string;
}> = ({ label, onCommit, placeholder, className }) => {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== label) onCommit(trimmed);
  };

  return (
    <input
      type='text'
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
      maxLength={20}
      className={className}
      title={draft}
    />
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
  const [newColorLabel, setNewColorLabel] = useState('');

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
    const label = newColorLabel.trim();
    onUserHighlightColorsChange([...userHighlightColors, label ? { hex, label } : { hex }]);
    setNewColorLabel('');
  };

  const handleDeleteUserColor = (hex: string) => {
    const key = normalizeHex(hex);
    onUserHighlightColorsChange(userHighlightColors.filter((entry) => entry.hex !== key));
  };

  const handleUserHexChange = (oldHex: string, newHex: string) => {
    const oldKey = normalizeHex(oldHex);
    const newKey = normalizeHex(newHex);
    if (oldKey === newKey) return;
    // Drop the rename if it collides with another existing color.
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
        <div className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
          {DEFAULT_HIGHLIGHT_COLORS.map((color, index, array) => {
            const position = index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
            return (
              <div key={color} className='flex min-w-0 flex-col items-center gap-2'>
                <LabelInput
                  label={defaultHighlightLabels[color] ?? ''}
                  onCommit={(next) => handleDefaultLabelChange(color, next)}
                  placeholder={_('Name')}
                  className='input input-xs bg-base-100 border-base-200/75 h-6 w-full min-w-0 max-w-24 text-center text-xs'
                />
                <div className='border-base-300 h-8 w-8 rounded-full border-2 shadow-sm'>
                  <div
                    className='h-full w-full rounded-full'
                    style={{
                      backgroundColor: customHighlightColors[color],
                      ...highlightPreviewStyle,
                    }}
                  />
                </div>
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
          <div className='mb-2 flex items-center justify-between'>
            <span className='font-normal'>
              {_('Custom Colors')} ({userHighlightColors.length}/{MAX_USER_HIGHLIGHT_COLORS})
            </span>
            <div className='flex flex-wrap items-center gap-2'>
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
              <input
                type='text'
                value={newColorLabel}
                onChange={(e) => setNewColorLabel(e.target.value)}
                placeholder={_('Name')}
                maxLength={20}
                className='input input-xs bg-base-100 border-base-200/75 h-6 w-24 text-center text-xs'
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
                <div key={hex} className='group relative flex min-w-0 flex-col items-center gap-2'>
                  <LabelInput
                    label={label ?? ''}
                    onCommit={(next) => handleUserLabelChange(hex, next)}
                    placeholder={_('Name')}
                    className='input input-xs bg-base-100 border-base-200/75 h-6 w-full min-w-0 max-w-24 text-center text-xs'
                  />
                  <div className='border-base-300 h-8 w-8 rounded-full border-2 shadow-sm'>
                    <div
                      className='h-full w-full rounded-full'
                      style={{ backgroundColor: hex, ...highlightPreviewStyle }}
                    />
                  </div>
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
  );
};

export default HighlightColorsEditor;
