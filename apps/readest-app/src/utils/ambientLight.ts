import type { ThemeMode } from '@/styles/themes';

/** Lux below this → dark page theme (Match Surroundings). */
export const AMBIENT_DARK_LUX_THRESHOLD = 20;

/** Lux above this → light page theme (Match Surroundings). */
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
 * - mode: ThemeMode including surroundings.
 * - systemIsDarkMode: OS appearance when mode is auto.
 * - ambientIsDarkMode: lux-derived flag when mode is surroundings.
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
  if (mode === 'surroundings') return ambientIsDarkMode;
  return systemIsDarkMode;
}

const THEME_MODES_BASE: ThemeMode[] = ['auto', 'light', 'dark'];
const THEME_MODES_WITH_SURROUNDINGS: ThemeMode[] = ['auto', 'light', 'dark', 'surroundings'];

/**
 * Cycle Auto → Light → Dark → (Match Surroundings) → Auto.
 *
 * Receives:
 * - current: active ThemeMode.
 * - hasSurroundings: whether Match Surroundings is offered on this device.
 *
 * Returns:
 * - the next ThemeMode in the cycle.
 */
export function nextThemeMode(current: ThemeMode, hasSurroundings: boolean): ThemeMode {
  const modes = hasSurroundings ? THEME_MODES_WITH_SURROUNDINGS : THEME_MODES_BASE;
  const effective: ThemeMode = current === 'surroundings' && !hasSurroundings ? 'auto' : current;
  const idx = modes.indexOf(effective);
  const nextIdx = idx < 0 ? 0 : (idx + 1) % modes.length;
  return modes[nextIdx] ?? 'auto';
}

export function isValidThemeMode(value: string | null): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark' || value === 'surroundings';
}
