import clsx from 'clsx';
import React from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { HighlightColor, HighlightStyle } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const styles = ['highlight', 'underline', 'squiggly'] as HighlightStyle[];
const colors = ['red', 'violet', 'blue', 'green', 'yellow'] as HighlightColor[];

interface HighlightOptionsProps {
  style: React.CSSProperties;
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor;
  onHandleHighlight: (update: boolean) => void;
}

const HighlightOptions: React.FC<HighlightOptionsProps> = ({
  style,
  selectedStyle: _selectedStyle,
  selectedColor: _selectedColor,
  onHandleHighlight,
}) => {
  const { settings, setSettings } = useSettingsStore();
  const globalReadSettings = settings.globalReadSettings;
  const [selectedStyle, setSelectedStyle] = React.useState<HighlightStyle>(_selectedStyle);
  const [selectedColor, setSelectedColor] = React.useState<HighlightColor>(_selectedColor);
  const size16 = useResponsiveSize(16);
  const size18 = useResponsiveSize(18);
  const size28 = useResponsiveSize(28);

  const handleSelectStyle = (style: HighlightStyle) => {
    globalReadSettings.highlightStyle = style;
    setSettings(settings);
    setSelectedStyle(style);
    setSelectedColor(globalReadSettings.highlightStyles[style]);
    onHandleHighlight(true);
  };
  const handleSelectColor = (color: HighlightColor) => {
    globalReadSettings.highlightStyle = selectedStyle;
    globalReadSettings.highlightStyles[selectedStyle] = color;
    setSettings(settings);
    setSelectedColor(color);
    onHandleHighlight(true);
  };
  return (
    <div className='highlight-options absolute flex items-center justify-between' style={style}>
      <div className='flex gap-2' style={{ height: size28 }}>
        {styles.map((style) => (
          <button
            key={style}
            onClick={() => handleSelectStyle(style)}
            className={`flex items-center justify-center rounded-full bg-gray-700 p-0`}
            style={{ width: size28, height: size28, minHeight: size28 }}
          >
            <div
              style={{ width: size16, height: style === 'squiggly' ? size18 : size16 }}
              className={clsx(
                'w-4 p-0 text-center leading-none',
                style === 'highlight' &&
                  (selectedStyle === 'highlight' ? `bg-${selectedColor}-400` : `bg-gray-300`),
                (style === 'underline' || style === 'squiggly') &&
                  'text-gray-300 underline decoration-2',
                style === 'underline' &&
                  (selectedStyle === 'underline'
                    ? `decoration-${selectedColor}-400`
                    : `decoration-gray-300`),
                style === 'squiggly' &&
                  (selectedStyle === 'squiggly'
                    ? `decoration-wavy decoration-${selectedColor}-400`
                    : `decoration-gray-300 decoration-wavy`),
              )}
            >
              A
            </div>
          </button>
        ))}
      </div>

      <div
        className='flex items-center justify-center gap-2 rounded-3xl bg-gray-700 px-2'
        style={{ height: size28 }}
      >
        {colors.map((color) => (
          <button
            key={color}
            onClick={() => handleSelectColor(color)}
            style={{ width: size16, height: size16 }}
            className={clsx(`rounded-full p-0`, selectedColor !== color && `bg-${color}-400`)}
          >
            {selectedColor === color && (
              <FaCheckCircle size={size16} className={clsx(`fill-${color}-400`)} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default HighlightOptions;
