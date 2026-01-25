import React, { useState } from 'react';
import { MdClose } from 'react-icons/md';
import { HighlightColor } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import ColorInput from './ColorInput';

const MAX_USER_HIGHLIGHT_COLORS = 10;

interface HighlightColorsEditorProps {
  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: string[];
  onChange: (colors: Record<HighlightColor, string>) => void;
  onUserColorsChange: (colors: string[]) => void;
}

const HighlightColorsEditor: React.FC<HighlightColorsEditorProps> = ({
  customHighlightColors,
  userHighlightColors,
  onChange,
  onUserColorsChange,
}) => {
  const _ = useTranslation();
  const [newColor, setNewColor] = useState('#808080');

  const handleColorChange = (color: HighlightColor, value: string) => {
    const updated = { ...customHighlightColors, [color]: value };
    onChange(updated);
  };

  const handleAddUserColor = () => {
    if (userHighlightColors.length >= MAX_USER_HIGHLIGHT_COLORS) return;
    if (!userHighlightColors.includes(newColor)) {
      const updatedColors = [...userHighlightColors, newColor];
      onUserColorsChange(updatedColors);
    }
  };

  const handleDeleteUserColor = (hex: string) => {
    const updatedColors = userHighlightColors.filter((c) => c !== hex);
    onUserColorsChange(updatedColors);
  };

  const handleUserColorChange = (oldHex: string, newHex: string) => {
    const updatedColors = userHighlightColors.map((c) => (c === oldHex ? newHex : c));
    onUserColorsChange(updatedColors);
  };

  return (
    <div>
      <h2 className='mb-2 font-medium'>{_('Highlight Colors')}</h2>
      <div className='card border-base-200 bg-base-100 overflow-visible border p-4 shadow'>
        <div className='space-y-4'>
          <div className='grid grid-cols-3 gap-3 sm:grid-cols-5'>
            {(['red', 'violet', 'blue', 'green', 'yellow'] as HighlightColor[]).map(
              (color, index, array) => {
                const position =
                  index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
                return (
                  <div key={color} className='flex flex-col items-center gap-2'>
                    <div
                      className='border-base-300 h-8 w-8 rounded-full border-2 shadow-sm'
                      style={{ backgroundColor: customHighlightColors[color] }}
                    />
                    <ColorInput
                      label=''
                      value={customHighlightColors[color]!}
                      compact={true}
                      pickerPosition={position}
                      onChange={(value: string) => handleColorChange(color, value)}
                    />
                  </div>
                );
              },
            )}
          </div>

          {(userHighlightColors.length > 0 || true) && (
            <div className='border-base-200 border-t pt-4'>
              <div className='mb-3 flex items-center justify-between'>
                <span className='text-sm font-medium'>
                  {_('Custom Colors')} ({userHighlightColors.length}/{MAX_USER_HIGHLIGHT_COLORS})
                </span>
                <div className='flex items-center gap-2'>
                  <div
                    className='border-base-300 h-6 w-6 rounded-full border-2 shadow-sm'
                    style={{ backgroundColor: newColor }}
                  />
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
                      userHighlightColors.includes(newColor) ||
                      userHighlightColors.length >= MAX_USER_HIGHLIGHT_COLORS
                    }
                    className='btn btn-ghost btn-sm gap-1 bg-transparent disabled:bg-transparent disabled:opacity-40'
                  >
                    <span className='text-xs'>{_('Add')}</span>
                  </button>
                </div>
              </div>

              {userHighlightColors.length > 0 && (
                <div className='grid grid-cols-3 gap-3 sm:grid-cols-5'>
                  {userHighlightColors.map((hex, index) => (
                    <div key={hex} className='group relative flex flex-col items-center gap-2'>
                      <div
                        className='border-base-300 h-8 w-8 rounded-full border-2 shadow-sm'
                        style={{ backgroundColor: hex }}
                      />
                      <ColorInput
                        label=''
                        value={hex}
                        compact={true}
                        pickerPosition={index === 0 ? 'left' : 'center'}
                        onChange={(value: string) => handleUserColorChange(hex, value)}
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
          )}
        </div>
      </div>
    </div>
  );
};

export default HighlightColorsEditor;
