import type { ThemeMode } from '@/styles/themes';

/** Lux below this → dark page theme (Ambient Mode). */
export const AMBIENT_DARK_LUX_THRESHOLD = 20;

/** Lux above this → light page theme (Ambient Mode). */
export const AMBIENT_LIGHT_LUX_THRESHOLD = 50;

/**
 * Map ambient lux to dark/light with hysteresis so the theme does not
 * flicker when illuminance sits near a single threshold.
 *
 * Receives:
 * - lux: ambient illuminance in lux.
 * - previousIsDark: last resolved dark flag, or null on the first reading.
 *
 * Returns:
 * - whether the reader should use the dark palette.
 */
export function resolveAmbientIsDarkMode(lux: number, previousIsDark: boolean | null): boolean {
  if (previousIsDark === null) {
    const mid = (AMBIENT_DARK_LUX_THRESHOLD + AMBIENT_LIGHT_LUX_THRESHOLD) / 2;
    return lux < mid;
  }
  if (lux < AMBIENT_DARK_LUX_THRESHOLD) return true;
  if (lux > AMBIENT_LIGHT_LUX_THRESHOLD) return false;
  return previousIsDark;
}

/**
 * Resolve effective dark mode from theme mode and system/ambient flags.
 *
 * Receives:
 * - mode: ThemeMode including ambient.
 * - systemIsDarkMode: OS appearance when mode is auto.
 * - ambientIsDarkMode: lux-derived flag when mode is ambient.
 *
 * Returns:
 * - whether the UI and reader should render as dark.
 */
export function resolveThemeIsDarkMode(
  mode: ThemeMode,
  systemIsDarkMode: boolean,
  ambientIsDarkMode: boolean,
): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (mode === 'ambient') return ambientIsDarkMode;
  return systemIsDarkMode;
}

const THEME_MODES_BASE: ThemeMode[] = ['auto', 'light', 'dark'];
const THEME_MODES_WITH_AMBIENT: ThemeMode[] = ['auto', 'light', 'dark', 'ambient'];

/**
 * Cycle Auto → Light → Dark → (Ambient Mode) → Auto.
 *
 * Receives:
 * - current: active ThemeMode.
 * - hasAmbient: whether Ambient Mode is offered on this device.
 *
 * Returns:
 * - the next ThemeMode in the cycle.
 */
export function nextThemeMode(current: ThemeMode, hasAmbient: boolean): ThemeMode {
  const modes = hasAmbient ? THEME_MODES_WITH_AMBIENT : THEME_MODES_BASE;
  const effective: ThemeMode = current === 'ambient' && !hasAmbient ? 'auto' : current;
  const idx = modes.indexOf(effective);
  const nextIdx = idx < 0 ? 0 : (idx + 1) % modes.length;
  return modes[nextIdx] ?? 'auto';
}

/**
 * Read the persisted ambient dark flag, falling back to the system appearance
 * until the first lux reading has been stored. Shared by the theme store and
 * `getThemeCode` so the app chrome and the book content cannot disagree.
 */
export function readStoredAmbientIsDarkMode(
  stored: string | null,
  systemIsDarkMode: boolean,
): boolean {
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return systemIsDarkMode;
}

export function isValidThemeMode(value: string | null): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark' || value === 'ambient';
}
