import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { FaCheckCircle, FaPlus } from 'react-icons/fa';
import { MdClose } from 'react-icons/md';
import { SketchPicker } from 'react-color';
import { HighlightColor, HighlightStyle } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { saveSysSettings } from '@/helpers/settings';

const styles = ['highlight', 'underline', 'squiggly'] as HighlightStyle[];
const defaultColors = ['red', 'violet', 'blue', 'green', 'yellow'] as HighlightColor[];
const MAX_USER_HIGHLIGHT_COLORS = 4;

const getColorHex = (
  customColors: Record<HighlightColor, string>,
  color: HighlightColor | string,
): string => {
  if (color.startsWith('#')) return color;
  return customColors[color as HighlightColor] ?? color;
};

interface HighlightOptionsProps {
  isVertical: boolean;
  popupWidth: number;
  popupHeight: number;
  triangleDir: 'up' | 'down' | 'left' | 'right';
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor | string;
  onHandleHighlight: (update: boolean) => void;
}

const OPTIONS_HEIGHT_PIX = 28;
const OPTIONS_PADDING_PIX = 16;

const HighlightOptions: React.FC<HighlightOptionsProps> = ({
  isVertical,
  popupWidth,
  popupHeight,
  triangleDir,
  selectedStyle: _selectedStyle,
  selectedColor: _selectedColor,
  onHandleHighlight,
}) => {
  const { envConfig } = useEnv();
  const { settings, saveSettings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const globalReadSettings = settings.globalReadSettings;
  const isEink = settings.globalViewSettings.isEink;
  const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
  const customColors = globalReadSettings.customHighlightColors;
  const userColors = globalReadSettings.userHighlightColors ?? [];
  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(_selectedStyle);
  const [selectedColor, setSelectedColor] = useState<HighlightColor | string>(_selectedColor);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerColor, setPickerColor] = useState('#808080');
  const pickerRef = useRef<HTMLDivElement>(null);
  const size16 = useResponsiveSize(16);
  const size28 = useResponsiveSize(28);
  const highlightOptionsHeightPx = useResponsiveSize(OPTIONS_HEIGHT_PIX);
  const highlightOptionsPaddingPx = useResponsiveSize(OPTIONS_PADDING_PIX);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    };
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker]);

  const handleSelectStyle = (style: HighlightStyle) => {
    const newGlobalReadSettings = { ...globalReadSettings, highlightStyle: style };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
    setSelectedStyle(style);
    setSelectedColor(globalReadSettings.highlightStyles[style]);
    onHandleHighlight(true);
  };

  const handleSelectColor = (color: HighlightColor | string) => {
    const newGlobalReadSettings = {
      ...globalReadSettings,
      highlightStyle: selectedStyle,
      highlightStyles: { ...globalReadSettings.highlightStyles, [selectedStyle]: color },
    };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
    setSelectedColor(color);
    onHandleHighlight(true);
  };

  const handleAddUserColor = () => {
    if (userColors.length >= MAX_USER_HIGHLIGHT_COLORS) {
      setShowPicker(false);
      return;
    }
    if (!userColors.includes(pickerColor)) {
      const updatedColors = [...userColors, pickerColor];
      const newGlobalReadSettings = {
        ...globalReadSettings,
        userHighlightColors: updatedColors,
        highlightStyles: { ...globalReadSettings.highlightStyles, [selectedStyle]: pickerColor },
      };
      saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
      saveSettings(envConfig, settings);
      setSelectedColor(pickerColor);
      onHandleHighlight(true);
    }
    setShowPicker(false);
  };

  const handleDeleteUserColor = (hex: string) => {
    const updatedColors = userColors.filter((c) => c !== hex);
    const newGlobalReadSettings = { ...globalReadSettings, userHighlightColors: updatedColors };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
    saveSettings(envConfig, settings);
  };

  return (
    <div
      className={clsx(
        'highlight-options absolute flex items-center justify-between',
        isVertical ? 'flex-col' : 'flex-row',
      )}
      style={{
        width: `${popupWidth}px`,
        height: `${popupHeight}px`,
        ...(isVertical
          ? {
              left: `${
                (highlightOptionsHeightPx + highlightOptionsPaddingPx) *
                (triangleDir === 'left' ? -1 : 1)
              }px`,
            }
          : {
              top: `${
                (highlightOptionsHeightPx + highlightOptionsPaddingPx) *
                (triangleDir === 'up' ? -1 : 1)
              }px`,
            }),
      }}
    >
      <div
        className={clsx('flex gap-2', isVertical ? 'flex-col' : 'flex-row')}
        style={isVertical ? { width: size28 } : { height: size28 }}
      >
        {styles.map((style) => (
          <button
            key={style}
            onClick={() => handleSelectStyle(style)}
            className='not-eink:bg-gray-700 eink-bordered flex items-center justify-center rounded-full p-0'
            style={{ width: size28, height: size28, minHeight: size28 }}
          >
            <div
              style={{
                width: size16,
                height: size16,
                ...(style === 'highlight' &&
                  selectedStyle === 'highlight' && {
                    backgroundColor: isEink
                      ? einkFgColor
                      : getColorHex(customColors, selectedColor),
                    color: isEink ? einkBgColor : '#d1d5db',
                    paddingTop: '2px',
                  }),
                ...(style === 'highlight' &&
                  selectedStyle !== 'highlight' && {
                    backgroundColor: '#d1d5db',
                    paddingTop: '2px',
                  }),
                ...((style === 'underline' || style === 'squiggly') && {
                  color: isEink ? einkFgColor : '#d1d5db',
                  textDecoration: 'underline',
                  textDecorationThickness: '2px',
                  textDecorationColor:
                    selectedStyle === style
                      ? isEink
                        ? einkFgColor
                        : getColorHex(customColors, selectedColor)
                      : '#d1d5db',
                  ...(style === 'squiggly' && { textDecorationStyle: 'wavy' }),
                }),
              }}
              className='w-4 p-0 text-center leading-none'
            >
              A
            </div>
          </button>
        ))}
      </div>

      <div
        className={clsx(
          'not-eink:bg-gray-700 eink-bordered flex items-center justify-center gap-2 rounded-3xl',
          isVertical ? 'flex-col py-2' : 'flex-row px-2',
        )}
        style={isVertical ? { width: size28 } : { height: size28 }}
      >
        {defaultColors
          .filter((c) => (isEink ? selectedColor === c : true))
          .map((color) => (
            <button
              key={color}
              onClick={() => handleSelectColor(color)}
              style={{
                width: size16,
                height: size16,
                backgroundColor: selectedColor !== color ? customColors[color] : 'transparent',
              }}
              className='rounded-full p-0'
            >
              {selectedColor === color && (
                <FaCheckCircle
                  size={size16}
                  style={{ fill: isEink ? einkFgColor : customColors[color] }}
                />
              )}
            </button>
          ))}

        {!isEink &&
          userColors.map((hex) => (
            <div key={hex} className='group relative flex items-center'>
              <button
                onClick={() => handleSelectColor(hex)}
                style={{ width: size16, height: size16, backgroundColor: hex }}
                className='rounded-full p-0'
              >
                {selectedColor === hex && <FaCheckCircle size={size16} style={{ fill: hex }} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteUserColor(hex);
                }}
                className='absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100'
              >
                <MdClose size={8} />
              </button>
            </div>
          ))}

        {!isEink && userColors.length < MAX_USER_HIGHLIGHT_COLORS && (
          <div className='relative flex items-center' ref={pickerRef}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              style={{ width: size16, height: size16 }}
              className='flex items-center justify-center rounded-full border border-dashed border-gray-400 p-0'
            >
              <FaPlus size={8} className='text-gray-400' />
            </button>
            {showPicker && (
              <div className='absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2'>
                <SketchPicker
                  color={pickerColor}
                  onChange={(c) => setPickerColor(c.hex)}
                  disableAlpha={true}
                  width='180px'
                />
                <button
                  onClick={handleAddUserColor}
                  className='btn btn-xs mt-1 w-full bg-gray-600 text-white'
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HighlightOptions;
