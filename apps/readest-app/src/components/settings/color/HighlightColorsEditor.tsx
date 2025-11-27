import React from 'react';
import { HighlightColor } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import ColorInput from './ColorInput';

interface HighlightColorsEditorProps {
  customHighlightColors: Record<HighlightColor, string>;
  onChange: (colors: Record<HighlightColor, string>) => void;
}

const HighlightColorsEditor: React.FC<HighlightColorsEditorProps> = ({
  customHighlightColors,
  onChange,
}) => {
  const _ = useTranslation();

  const handleColorChange = (color: HighlightColor, value: string) => {
    const updated = { ...customHighlightColors, [color]: value };
    onChange(updated);
  };

  return (
    <div>
      <h2 className='mb-2 font-medium'>{_('Highlight Colors')}</h2>
      <div className='card border-base-200 bg-base-100 overflow-visible border p-4 shadow'>
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
                    value={customHighlightColors[color]}
                    compact={true}
                    pickerPosition={position}
                    onChange={(value: string) => handleColorChange(color, value)}
                  />
                </div>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
};

export default HighlightColorsEditor;
