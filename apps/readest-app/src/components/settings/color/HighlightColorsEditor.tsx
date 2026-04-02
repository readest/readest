import React, { useState } from 'react';
import { MdClose } from 'react-icons/md';
import { HighlightColor } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import NumberInput from '../NumberInput';
import ColorInput from './ColorInput';

const MAX_USER_HIGHLIGHT_COLORS = 10;

interface HighlightColorsEditorProps {
  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: string[];
  highlightOpacity: number;
  isEink: boolean;
  onChange: (colors: Record<HighlightColor, string>) => void;
  onUserColorsChange: (colors: string[]) => void;
  onOpacityChange: (opacity: number) => void;
}

const HighlightColorsEditor: React.FC<HighlightColorsEditorProps> = ({
  customHighlightColors,
  userHighlightColors,
  highlightOpacity,
  isEink,
  onChange,
  onUserColorsChange,
  onOpacityChange,
}) => {
  const _ = useTranslation();
  const [newColor, setNewColor] = useState('#808080');

  const highlightPreviewStyle: React.CSSProperties = {
    opacity: highlightOpacity,
    mixBlendMode:
      'var(--overlayer-highlight-blend-mode, normal)' as React.CSSProperties['mixBlendMode'],
  };

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
      <div className='card border-base-200 bg-base-100 overflow-visible border shadow'>
        <div className='grid grid-cols-3 gap-3 p-4 sm:grid-cols-5'>
          {(['red', 'violet', 'blue', 'green', 'yellow'] as HighlightColor[]).map(
            (color, index, array) => {
              const position =
                index === 0 ? 'left' : index === array.length - 1 ? 'right' : 'center';
              return (
                <div key={color} className='flex flex-col items-center gap-2'>
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
                    onChange={(value: string) => handleColorChange(color, value)}
                  />
                </div>
              );
            },
          )}
        </div>

        {(userHighlightColors.length > 0 || true) && (
          <div className='border-base-200 border-t p-4'>
            <div className='mb-2 flex items-center justify-between'>
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
