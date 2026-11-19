import type { ViewSettings } from '@/types/book';

/** The only shape `ColorInput` emits (`HexColorInput` with `prefixed`). */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/**
 * Settings written before these fields existed (and the partial view settings
 * built in tests) leave them undefined, which has to read as the untouched
 * default rather than as a deliberate choice.
 */
const getBackground = (viewSettings: ViewSettings): string =>
  viewSettings.headerFooterBackground || 'auto';

/**
 * Font size in px for the header/footer info. E-ink falls back higher because
 * its chrome used to hard-code `text-sm` where every other mode used
 * `text-xs`.
 */
export const getChromeFontSize = (viewSettings: ViewSettings, isEink: boolean): number =>
  viewSettings.headerFooterFontSize || (isEink ? 14 : 12);

/**
 * Backdrop resolved for one piece of reader chrome, or `null` for none.
 *  - `theme`: the built-in `bg-base-100/85` pill (a utility class, so it
 *    tracks the theme and picks up `eink-bordered`)
 *  - `custom`: an inline `#rrggbbaa` from the reader's own choice
 */
export type ChromeChip = { kind: 'theme' } | { kind: 'custom'; color: string };

/**
 * True once the reader has taken the chrome's legibility into their own hands
 * with an explicit color or backdrop.
 *
 * The fixed-layout `mix-blend-difference` fallback (#4901) has to stand down
 * then: it would invert the chosen text color, and differencing a child that
 * carries its own background paints it solid black (#5342). It also means
 * "Background: none" reads as genuinely transparent on a PDF rather than
 * flipping the blend back on.
 */
export const isChromeStyled = (viewSettings: ViewSettings): boolean =>
  isHexColor(viewSettings.headerFooterTextColor) || getBackground(viewSettings) !== 'auto';

/**
 * Text color for the header/footer info, or `undefined` to leave the themed
 * `text-base-content` class in charge. E-ink renders an arbitrary hue as mud,
 * so it always keeps the themed color.
 */
export const getChromeTextColor = (
  viewSettings: ViewSettings,
  isEink: boolean,
): string | undefined => {
  if (isEink || !isHexColor(viewSettings.headerFooterTextColor)) return undefined;
  return viewSettings.headerFooterTextColor;
};

/** A custom backdrop for horizontal header and footer info. */
export const getChromeChip = (
  viewSettings: ViewSettings,
  { isEink, isVertical }: { isEink: boolean; isVertical: boolean },
): ChromeChip | null => {
  const background = getBackground(viewSettings);
  if (isVertical || !isHexColor(background)) return null;
  // E-ink keeps the opaque themed pill: the hue would render as an
  // indistinguishable gray, and the theme chip carries `eink-bordered`.
  if (isEink) return { kind: 'theme' };
  const opacity = viewSettings.headerFooterBgOpacity ?? 0.85;
  return { kind: 'custom', color: withOpacity(background, opacity) };
};

/**
 * Folds an alpha into a `#rrggbb` as an 8-digit hex. Cheaper and lossless
 * next to parsing into `rgba()`, and supported everywhere the app runs.
 */
const withOpacity = (hex: string, opacity: number): string => {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  return `${hex}${alpha.toString(16).padStart(2, '0')}`;
};
