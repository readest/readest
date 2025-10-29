import React from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import Select from '@/components/Select';
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

  const handleAddCustomColor = () => {
    if (!customColors.includes(color) && !defaultQuickColors.some((c) => c.color === color)) {
      const updatedColors = [...customColors, color];
      onCustomColorsChange(updatedColors);
    }
  };

  const handleDeleteCustomColor = (colorToDelete: string) => {
    const updatedColors = customColors.filter((c) => c !== colorToDelete);
    onCustomColorsChange(updatedColors);
  };

  return (
    <div className='w-full'>
      <h2 className='mb-2 font-medium'>{_('TTS Highlighting')}</h2>
      <div className='card border-base-200 bg-base-100 border p-4 shadow'>
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{_('Style')}</span>
            <Select
              value={style}
              onChange={(e) => onStyleChange(e.target.value as TTSHighlightStyle)}
              options={[
                { value: 'highlight', label: _('Highlighter') },
                { value: 'underline', label: _('Underline') },
                { value: 'strikethrough', label: _('Strikethrough') },
                { value: 'squiggly', label: _('Squiggly') },
                { value: 'outline', label: _('Outline') },
              ]}
            />
          </div>

          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{_('Color')}</span>
            <div className='flex items-center gap-2'>
              <div
                className='border-base-300 pointer-events-none h-8 w-8 cursor-pointer rounded-full border-2 shadow-sm'
                style={{ backgroundColor: color }}
              />
              <ColorInput
                label=''
                value={color}
                compact={true}
                pickerPosition='center'
                onChange={onColorChange}
              />
              <button
                onClick={handleAddCustomColor}
                disabled={
                  customColors.includes(color) || defaultQuickColors.some((c) => c.color === color)
                }
                className='btn btn-ghost btn-sm gap-1 bg-transparent disabled:bg-transparent'
                title={_('Save Current Color')}
              >
                <span className='text-xs'>{_('Save')}</span>
              </button>
            </div>
          </div>

          <div className='border-base-200 flex justify-between border-t pt-4'>
            <div className='flex items-center'>
              <span className='text-sm font-medium'>{_('Quick Colors')}</span>
            </div>

            <div className='flex max-w-[70%] flex-wrap justify-end gap-2'>
              {defaultQuickColors.map(({ color: quickColor }) => (
                <button
                  key={quickColor}
                  onClick={() => onColorChange(quickColor)}
                  className={`h-8 w-8 rounded-full border-2 transition-all hover:scale-110 ${
                    color === quickColor
                      ? 'ring-2 ring-indigo-500 ring-offset-2'
                      : 'border-base-300'
                  }`}
                  style={{ backgroundColor: quickColor }}
                />
              ))}

              {customColors.map((customColor) => (
                <div key={customColor} className='group relative'>
                  <button
                    onClick={() => onColorChange(customColor)}
                    className={`h-8 w-8 rounded-full border-2 transition-all hover:scale-110 ${
                      color === customColor
                        ? 'ring-2 ring-indigo-500 ring-offset-2'
                        : 'border-base-300'
                    }`}
                    style={{ backgroundColor: customColor }}
                  />
                  <button
                    onClick={() => handleDeleteCustomColor(customColor)}
                    className='absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100'
                    title={_('Delete')}
                  >
                    <MdClose size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TTSHighlightStyleEditor;
