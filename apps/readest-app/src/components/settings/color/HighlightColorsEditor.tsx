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
import { BoxedList, SettingLabel } from '../primitives';
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
 * Floating popover with a single text input — used to rename a highlight
 * color label. Anchored above its relative-positioned parent.
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
      className='bg-base-100 border-base-300 absolute -top-9 start-1/2 z-50 -translate-x-1/2 rounded-md border px-1 py-0.5 shadow-lg'
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
        className='bg-base-100 w-24 text-center text-xs outline-none'
      />
    </div>
  );
};

/**
 * Inline editable label below a color swatch. Click to open the
 * <LabelPopover>. Shows the user-set label, or `placeholder` when empty
 * (e.g. "Add label" hint).
 */
const EditableLabel: React.FC<{
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}> = ({ value, placeholder, onCommit }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div className='relative flex w-full justify-center'>
      {editing && (
        <LabelPopover label={value} onCommit={onCommit} onClose={() => setEditing(false)} />
      )}
      <button
        type='button'
        onClick={() => setEditing(true)}
        className={clsx(
          'hover:text-base-content max-w-full truncate text-xs hover:underline',
          value ? 'text-base-content/75' : 'text-base-content/40',
        )}
        title={value || placeholder}
      >
        {value || placeholder}
      </button>
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

  // Localized fallback names for the built-in highlight colors. Shown as
  // greyed-out placeholders below each swatch; once the user enters their
  // own label it replaces this hint.
  const defaultColorNames: Record<DefaultHighlightColor, string> = {
    red: _('Red'),
    yellow: _('Yellow'),
    green: _('Green'),
    blue: _('Blue'),
    violet: _('Violet'),
  };

  const handleDefaultHexChange = (color: HighlightColor, hex: string) => {
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

  // Two-trigger UX inside each color cell: clicking the SWATCH opens the
  // color picker (color edit), clicking the LABEL TEXT below opens the
  // label popover (rename). Matches the TTS Highlighting swatch+commit
  // pattern for color editing while preserving per-color labels.
  return (
    <BoxedList title={_('Highlight Colors')}>
      <div className='grid grid-cols-3 gap-3 py-4 pe-4 sm:grid-cols-5'>
        {DEFAULT_HIGHLIGHT_COLORS.map((color, index, array) => {
          const position = index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
          const userLabel = defaultHighlightLabels[color] ?? '';
          return (
            <div key={color} className='flex flex-col items-center gap-1.5'>
              <ColorInput
                label={_('Edit color')}
                value={customHighlightColors[color]!}
                swatchOnly
                pickerPosition={position}
                onChange={(value: string) => handleDefaultHexChange(color, value)}
              />
              <EditableLabel
                value={userLabel}
                placeholder={defaultColorNames[color]}
                onCommit={(next) => handleDefaultLabelChange(color, next)}
              />
            </div>
          );
        })}
      </div>

      <div className='py-4 pe-4'>
        <div
          className={clsx(
            'flex items-center justify-between',
            userHighlightColors.length > 0 && 'mb-4',
          )}
        >
          <SettingLabel>
            {_('Custom Colors')} ({userHighlightColors.length}/{MAX_USER_HIGHLIGHT_COLORS})
          </SettingLabel>
          {/* Swatch + picker icon — matches TTS Highlighting's Color row.
              Closing the picker fires onCommit, which auto-pins the color
              to the user's palette. */}
          <ColorInput
            label={_('Add custom color')}
            value={newColor}
            swatchOnly
            showPickerIcon
            pickerPosition='right'
            onChange={setNewColor}
            onCommit={handleAddUserColor}
          />
        </div>

        {userHighlightColors.length > 0 && (
          <div className='grid grid-cols-3 gap-3 sm:grid-cols-5'>
            {userHighlightColors.map(({ hex, label }, index) => (
              <div key={index} className='group relative flex flex-col items-center gap-1.5'>
                <ColorInput
                  label={_('Edit color')}
                  value={hex}
                  swatchOnly
                  pickerPosition={index === 0 ? 'left' : 'center'}
                  onChange={(value: string) => handleUserHexChange(hex, value)}
                />
                <EditableLabel
                  value={label ?? ''}
                  placeholder={_('Add label')}
                  onCommit={(next) => handleUserLabelChange(hex, next)}
                />
                <button
                  onClick={() => handleDeleteUserColor(hex)}
                  className='absolute -end-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100'
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
        min={0.1}
        max={1}
        step={0.1}
      />
    </BoxedList>
  );
};

export default HighlightColorsEditor;
