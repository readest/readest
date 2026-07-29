import { describe, expect, it } from 'vitest';
import {
  AMBIENT_DARK_LUX_THRESHOLD,
  AMBIENT_LIGHT_LUX_THRESHOLD,
  isValidThemeMode,
  nextThemeMode,
  resolveAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';

describe('resolveAmbientIsDarkMode', () => {
  it('uses the midpoint on the first reading', () => {
    const mid = (AMBIENT_DARK_LUX_THRESHOLD + AMBIENT_LIGHT_LUX_THRESHOLD) / 2;
    expect(resolveAmbientIsDarkMode(mid - 1, null)).toBe(true);
    expect(resolveAmbientIsDarkMode(mid + 1, null)).toBe(false);
  });

  it('switches to dark only below the low threshold', () => {
    expect(resolveAmbientIsDarkMode(AMBIENT_DARK_LUX_THRESHOLD - 1, false)).toBe(true);
    expect(resolveAmbientIsDarkMode(AMBIENT_DARK_LUX_THRESHOLD, false)).toBe(false);
  });

  it('switches to light only above the high threshold', () => {
    expect(resolveAmbientIsDarkMode(AMBIENT_LIGHT_LUX_THRESHOLD + 1, true)).toBe(false);
    expect(resolveAmbientIsDarkMode(AMBIENT_LIGHT_LUX_THRESHOLD, true)).toBe(true);
  });

  it('holds the previous state inside the hysteresis band', () => {
    const band = (AMBIENT_DARK_LUX_THRESHOLD + AMBIENT_LIGHT_LUX_THRESHOLD) / 2;
    expect(resolveAmbientIsDarkMode(band, true)).toBe(true);
    expect(resolveAmbientIsDarkMode(band, false)).toBe(false);
  });
});

describe('resolveThemeIsDarkMode', () => {
  it('respects fixed light and dark modes', () => {
    expect(resolveThemeIsDarkMode('light', true, true)).toBe(false);
    expect(resolveThemeIsDarkMode('dark', false, false)).toBe(true);
  });

  it('uses system appearance in auto mode', () => {
    expect(resolveThemeIsDarkMode('auto', true, false)).toBe(true);
    expect(resolveThemeIsDarkMode('auto', false, true)).toBe(false);
  });

  it('uses ambient flag in surroundings mode', () => {
    expect(resolveThemeIsDarkMode('surroundings', false, true)).toBe(true);
    expect(resolveThemeIsDarkMode('surroundings', true, false)).toBe(false);
  });
});

describe('nextThemeMode', () => {
  it('cycles Auto → Light → Dark → Auto without surroundings', () => {
    expect(nextThemeMode('auto', false)).toBe('light');
    expect(nextThemeMode('light', false)).toBe('dark');
    expect(nextThemeMode('dark', false)).toBe('auto');
  });

  it('includes Match Surroundings when the sensor is available', () => {
    expect(nextThemeMode('auto', true)).toBe('light');
    expect(nextThemeMode('light', true)).toBe('dark');
    expect(nextThemeMode('dark', true)).toBe('surroundings');
    expect(nextThemeMode('surroundings', true)).toBe('auto');
  });

  it('treats surroundings as auto when the sensor is unavailable', () => {
    expect(nextThemeMode('surroundings', false)).toBe('light');
  });
});

describe('isValidThemeMode', () => {
  it('accepts known modes including surroundings', () => {
    expect(isValidThemeMode('auto')).toBe(true);
    expect(isValidThemeMode('light')).toBe(true);
    expect(isValidThemeMode('dark')).toBe(true);
    expect(isValidThemeMode('surroundings')).toBe(true);
    expect(isValidThemeMode('night')).toBe(false);
    expect(isValidThemeMode(null)).toBe(false);
  });
});
