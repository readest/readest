import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { DEFAULT_HIGHLIGHT_COLORS, HighlightColor, HighlightStyle } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useDragScroll } from '@/hooks/useDragScroll';
import { saveSysSettings } from '@/helpers/settings';
import { LONG_HOLD_THRESHOLD } from '@/services/constants';
import { getHighlightColorLabel } from '../../utils/annotatorUtil';
import { stubTranslation as _ } from '@/utils/misc';

// Register strings for the i18next extractor. These keys are translated by the
// component via `useTranslation` below.
const styles = [_('highlight'), _('underline'), _('squiggly')] as HighlightStyle[];
void [_('red'), _('yellow'), _('green'), _('blue'), _('violet')];

const getColorHex = (
  customColors: Record<HighlightColor, string>,
  color: HighlightColor,
): string => {
  if (color.startsWith('#')) return color;
  return customColors[color] ?? color;
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
const LABEL_PREVIEW_MS = 2200;

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
  const allColors: HighlightColor[] = [
    ...DEFAULT_HIGHLIGHT_COLORS,
    ...userColors.map((c) => c.hex),
  ];
  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(_selectedStyle);
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(_selectedColor);
  const [previewColor, setPreviewColor] = useState<HighlightColor | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTapRef = useRef(false);
  const colorStripRef = useRef<HTMLDivElement | null>(null);
  const size16 = useResponsiveSize(16);
  const size28 = useResponsiveSize(28);
  const highlightOptionsHeightPx = useResponsiveSize(OPTIONS_HEIGHT_PIX);
  const highlightOptionsPaddingPx = useResponsiveSize(OPTIONS_PADDING_PIX);

  const {
    isDragging: isDraggingColorStrip,
    pointerHandlers: stripPointerHandlers,
    shouldSuppressClick: shouldSuppressStripClick,
  } = useDragScroll(colorStripRef, { enabled: !isVertical });

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

  /**
   * Translate a color's label. Order of preference:
   *   1. user-set label (custom string, shown verbatim)
   *   2. translated default name (only for the 5 predefined colors)
   *   3. the color value itself (hex fallback)
   */
  const resolveHighlightLabel = (color: HighlightColor): string => {
    const userLabel = getHighlightColorLabel(settings, color);
    if (userLabel) return userLabel;
    if (!color.startsWith('#')) return _(color);
    return color;
  };

  const showHighlightLabelPreview = (color: HighlightColor) => {
    setPreviewColor(color);
    clearPreviewTimer();
    previewTimerRef.current = setTimeout(() => setPreviewColor(null), LABEL_PREVIEW_MS);
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

  const handleColorClick = (color: HighlightColor) => {
    if (shouldSuppressStripClick()) return;
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
        'highlight-options absolute flex items-center justify-between gap-4',
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
        {...stripPointerHandlers}
        className={clsx(
          'not-eink:bg-gray-700 eink-bordered flex items-center gap-2 rounded-3xl',
          isVertical ? 'flex-col overflow-y-auto py-2' : 'min-w-0 flex-row overflow-x-auto px-2',
          !isVertical && 'cursor-grab',
          !isVertical && isDraggingColorStrip && 'cursor-grabbing',
        )}
        style={{
          ...(isVertical ? { width: size28 } : { height: size28 }),
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitUserSelect: isDraggingColorStrip ? 'none' : undefined,
          userSelect: isDraggingColorStrip ? 'none' : undefined,
        }}
      >
        {allColors
          .filter((c) => (isBwEink ? selectedColor === c : true))
          .map((color) => {
            const label = resolveHighlightLabel(color);
            const swatchColor = customColors[color] || color;
            return (
              <div key={color} className='relative flex items-center justify-center'>
                {previewColor === color && (
                  <div
                    className='eink-bordered pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-800 px-2 py-0.5 text-[10px] text-white'
                    style={{ maxWidth: 120 }}
                  >
                    {label}
                  </div>
                )}
                <button
                  aria-label={_('Select {{color}} color', { color: label })}
                  title={label}
                  onClick={() => handleColorClick(color)}
                  onPointerDown={(event) => handleColorPointerDown(event, color)}
                  onPointerUp={handleColorPointerEnd}
                  onPointerLeave={handleColorPointerEnd}
                  onPointerCancel={handleColorPointerEnd}
                  style={{
                    width: size16,
                    height: size16,
                    backgroundColor: selectedColor !== color ? swatchColor : 'transparent',
                  }}
                  className='rounded-full p-0'
                >
                  {selectedColor === color && (
                    <FaCheckCircle
                      size={size16}
                      style={{ fill: isBwEink ? einkFgColor : swatchColor }}
                    />
                  )}
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default HighlightOptions;
