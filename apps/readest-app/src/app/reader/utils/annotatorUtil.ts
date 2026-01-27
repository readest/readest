import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { HighlightColor } from '@/types/book';
import { SystemSettings } from '@/types/settings';

export const getHighlightColorHex = (
  settings: SystemSettings,
  color?: HighlightColor,
): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  const customColors = settings.globalReadSettings.customHighlightColors;
  return customColors?.[color] ?? HIGHLIGHT_COLOR_HEX[color];
};
