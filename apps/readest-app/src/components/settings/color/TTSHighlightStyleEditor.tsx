import React from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList, SettingsRow, SettingsSelect } from '../primitives';
import ColorInput from './ColorInput';

export type TTSHighlightStyle =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'squiggly'
  | 'outline';

interface TTSHighlightStyleEditorProps {
  style: TTSHighlightStyle;
  color: string;
  customColors: string[];
  onStyleChange: (style: TTSHighlightStyle) => void;
  onColorChange: (color: string) => void;
  onCustomColorsChange: (colors: string[]) => void;
}

const TTSHighlightStyleEditor: React.FC<TTSHighlightStyleEditorProps> = ({
  style,
  color,
  customColors,
  onStyleChange,
  onColorChange,
  onCustomColorsChange,
}) => {
  const _ = useTranslation();

  const defaultQuickColors = [
    { color: '#FFD700', label: 'Gold' },
    { color: '#00CED1', label: 'Cyan' },
    { color: '#FF69B4', label: 'Pink' },
    { color: '#90EE90', label: 'Green' },
    { color: '#FFA500', label: 'Orange' },
  ];

  // Pin the current color to the user's Quick Colors palette. Validates
  // the hex first so partial typing (e.g. "#7a") doesn't get saved, and
  // skips colors that are already in the palette.
  const isValidHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
  const handleAddCustomColor = () => {
    if (
      isValidHex(color) &&
      !customColors.includes(color) &&
      !defaultQuickColors.some((c) => c.color === color)
    ) {
      const updatedColors = [...customColors, color];
      onCustomColorsChange(updatedColors);
    }
  };

  const handleDeleteCustomColor = (colorToDelete: string) => {
    const updatedColors = customColors.filter((c) => c !== colorToDelete);
    onCustomColorsChange(updatedColors);
  };

  return (
    <BoxedList title={_('TTS Highlighting')}>
      <SettingsRow label={_('Style')}>
        <SettingsSelect
          value={style}
          onChange={(e) => onStyleChange(e.target.value as TTSHighlightStyle)}
          ariaLabel={_('Style')}
          options={[
            { value: 'highlight', label: _('Highlighter') },
            { value: 'underline', label: _('Underline') },
            { value: 'strikethrough', label: _('Strikethrough') },
            { value: 'squiggly', label: _('Squiggly') },
            { value: 'outline', label: _('Outline') },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={_('Color')}>
        <ColorInput
          label={_('Choose color')}
          value={color}
          swatchOnly
          showPickerIcon
          pickerPosition='right'
          onChange={onColorChange}
          onCommit={handleAddCustomColor}
        />
      </SettingsRow>

      <SettingsRow label={_('Quick Colors')}>
        <div className='my-4 flex max-w-[65%] flex-wrap content-center items-center justify-end gap-2'>
          {defaultQuickColors.map(({ color: quickColor }) => (
            <button
              key={quickColor}
              onClick={() => onColorChange(quickColor)}
              className={`border-base-300 h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                color === quickColor ? 'ring-2 ring-indigo-500 ring-offset-1' : ''
              }`}
              style={{ backgroundColor: quickColor }}
            />
          ))}

          {customColors.map((customColor) => (
            <div key={customColor} className='group relative'>
              <button
                onClick={() => onColorChange(customColor)}
                className={`border-base-300 h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                  color === customColor ? 'ring-2 ring-indigo-500 ring-offset-1' : ''
                }`}
                style={{ backgroundColor: customColor }}
              />
              <button
                onClick={() => handleDeleteCustomColor(customColor)}
                className='absolute -end-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100'
                title={_('Delete')}
              >
                <MdClose size={12} />
              </button>
            </div>
          ))}
        </div>
      </SettingsRow>
    </BoxedList>
  );
};

export default TTSHighlightStyleEditor;
