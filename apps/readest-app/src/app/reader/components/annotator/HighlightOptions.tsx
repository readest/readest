import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { HighlightColor, HighlightStyle } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { saveSysSettings } from '@/helpers/settings';
import { LONG_HOLD_THRESHOLD } from '@/services/constants';
import { getHighlightColorLabel } from '../../utils/annotatorUtil';

const styles: HighlightStyle[] = ['highlight', 'underline', 'squiggly'];
const defaultColors: HighlightColor[] = ['red', 'violet', 'blue', 'green', 'yellow'];

const getColorHex = (
  customColors: Record<HighlightColor, string>,
  color: HighlightColor,
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
  selectedColor: HighlightColor;
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
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const globalReadSettings = settings.globalReadSettings;
  const isEink = settings.globalViewSettings.isEink;
  const isColorEink = settings.globalViewSettings.isColorEink;
  const isBwEink = isEink && !isColorEink;
  const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
  const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
  const customColors = globalReadSettings.customHighlightColors;
  const userColors = globalReadSettings.userHighlightColors ?? [];
  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(_selectedStyle);
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(_selectedColor);
  const [previewColor, setPreviewColor] = useState<HighlightColor | null>(null);
  const [previewLabel, setPreviewLabel] = useState('');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTapRef = useRef(false);
  const colorStripRef = useRef<HTMLDivElement | null>(null);
  const suppressColorClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressColorClickRef = useRef(false);
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const [isDraggingColorStrip, setIsDraggingColorStrip] = useState(false);
  const size16 = useResponsiveSize(16);
  const size28 = useResponsiveSize(28);
  const highlightOptionsHeightPx = useResponsiveSize(OPTIONS_HEIGHT_PIX);
  const highlightOptionsPaddingPx = useResponsiveSize(OPTIONS_PADDING_PIX);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clearPreviewTimer = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const clearSuppressColorClickTimer = () => {
    if (suppressColorClickTimerRef.current) {
      clearTimeout(suppressColorClickTimerRef.current);
      suppressColorClickTimerRef.current = null;
    }
  };

  const resolveHighlightLabel = (color: HighlightColor) => {
    const label = getHighlightColorLabel(settings, color);
    if (label === color && !color.startsWith('#')) {
      return _(color);
    }
    return label;
  };

  const showHighlightLabelPreview = (color: HighlightColor) => {
    setPreviewColor(color);
    setPreviewLabel(resolveHighlightLabel(color));
    clearPreviewTimer();
    previewTimerRef.current = setTimeout(() => {
      setPreviewColor(null);
      setPreviewLabel('');
    }, 2200);
  };

  const handleColorPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    color: HighlightColor,
  ) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return;
    }
    clearLongPressTimer();
    suppressTapRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      suppressTapRef.current = true;
      showHighlightLabelPreview(color);
    }, LONG_HOLD_THRESHOLD);
  };

  const handleColorPointerEnd = () => {
    clearLongPressTimer();
  };

  const handleColorStripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isVertical || event.pointerType !== 'mouse') {
      return;
    }
    const target = event.target as HTMLElement;
    const isColorButton = Boolean(target.closest('button'));
    if (!isColorButton) {
      return;
    }

    const strip = colorStripRef.current;
    if (!strip) {
      return;
    }

    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: strip.scrollLeft,
      moved: false,
    };
    setIsDraggingColorStrip(false);
  };

  const handleColorStripPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const strip = colorStripRef.current;
    const drag = dragStateRef.current;
    if (!strip || !drag.active) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaX) >= 6) {
      drag.moved = true;
      setIsDraggingColorStrip(true);
    }
    if (drag.moved) {
      strip.scrollLeft = drag.startScrollLeft - deltaX;
      event.preventDefault();
    }
  };

  const handleColorStripPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || event.pointerType !== 'mouse') {
      return;
    }

    const moved = drag.moved;
    drag.active = false;
    drag.moved = false;
    setIsDraggingColorStrip(false);

    if (moved) {
      clearSuppressColorClickTimer();
      suppressColorClickRef.current = true;
      suppressColorClickTimerRef.current = setTimeout(() => {
        suppressColorClickRef.current = false;
      }, 120);
    }
  };

  const handleColorClick = (color: HighlightColor) => {
    if (dragStateRef.current.active || suppressColorClickRef.current) {
      return;
    }
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    handleSelectColor(color);
  };

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearPreviewTimer();
      clearSuppressColorClickTimer();
      suppressColorClickRef.current = false;
      dragStateRef.current.active = false;
      dragStateRef.current.moved = false;
    };
  }, []);

  const handleSelectStyle = (style: HighlightStyle) => {
    const newGlobalReadSettings = { ...globalReadSettings, highlightStyle: style };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
    setSelectedStyle(style);
    setSelectedColor(globalReadSettings.highlightStyles[style]);
    onHandleHighlight(true);
  };

  const handleSelectColor = (color: HighlightColor) => {
    const newGlobalReadSettings = {
      ...globalReadSettings,
      highlightStyle: selectedStyle,
      highlightStyles: { ...globalReadSettings.highlightStyles, [selectedStyle]: color },
    };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
    setSelectedColor(color);
    onHandleHighlight(true);
  };

  return (
    <div
      className={clsx(
        'highlight-options absolute flex items-center gap-4',
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
            aria-label={_('Select {{style}} style', { style: _(style) })}
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
                    backgroundColor: isBwEink
                      ? einkFgColor
                      : getColorHex(customColors, selectedColor),
                    color: isBwEink ? einkBgColor : '#d1d5db',
                    paddingTop: '2px',
                  }),
                ...(style === 'highlight' &&
                  selectedStyle !== 'highlight' && {
                    backgroundColor: '#d1d5db',
                    paddingTop: '2px',
                  }),
                ...((style === 'underline' || style === 'squiggly') && {
                  color: isBwEink ? einkFgColor : '#d1d5db',
                  textDecoration: 'underline',
                  textDecorationThickness: '2px',
                  textDecorationColor:
                    selectedStyle === style
                      ? isBwEink
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
        ref={colorStripRef}
        className={clsx(
          'not-eink:bg-gray-700 eink-bordered flex items-center gap-2 rounded-3xl',
          isVertical
            ? 'flex-col overflow-y-auto py-2'
            : 'min-w-0 flex-1 flex-row overflow-x-auto px-2',
          !isVertical && 'cursor-grab',
          !isVertical && isDraggingColorStrip && 'cursor-grabbing',
        )}
        onPointerDown={handleColorStripPointerDown}
        onPointerMove={handleColorStripPointerMove}
        onPointerUp={handleColorStripPointerEnd}
        onPointerCancel={handleColorStripPointerEnd}
        onPointerLeave={handleColorStripPointerEnd}
        style={{
          ...(isVertical ? { width: size28 } : { height: size28 }),
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitUserSelect: isDraggingColorStrip ? 'none' : undefined,
          userSelect: isDraggingColorStrip ? 'none' : undefined,
        }}
      >
        {defaultColors
          .concat(userColors)
          .filter((c) => (isBwEink ? selectedColor === c : true))
          .map((color) => (
            <div key={color} className='relative flex items-center justify-center'>
              {previewColor === color && previewLabel && (
                <div
                  className='eink-bordered pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-800 px-2 py-0.5 text-[10px] text-white'
                  style={{ maxWidth: 120 }}
                >
                  {previewLabel}
                </div>
              )}
              <button
                key={color}
                aria-label={_('Select {{color}} color', { color: resolveHighlightLabel(color) })}
                title={resolveHighlightLabel(color)}
                onClick={() => handleColorClick(color)}
                onPointerDown={(event) => handleColorPointerDown(event, color)}
                onPointerUp={handleColorPointerEnd}
                onPointerLeave={handleColorPointerEnd}
                onPointerCancel={handleColorPointerEnd}
                style={{
                  width: size16,
                  height: size16,
                  backgroundColor:
                    selectedColor !== color ? customColors[color] || color : 'transparent',
                }}
                className='rounded-full p-0'
              >
                {selectedColor === color && (
                  <FaCheckCircle
                    size={size16}
                    style={{ fill: isBwEink ? einkFgColor : customColors[color] || color }}
                  />
                )}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
};

export default HighlightOptions;
