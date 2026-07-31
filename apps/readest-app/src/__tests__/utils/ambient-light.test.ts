import { describe, expect, it } from 'vitest';
import {
  AMBIENT_DARK_LUX_THRESHOLD,
  AMBIENT_LIGHT_LUX_THRESHOLD,
  isValidThemeMode,
  nextThemeMode,
  readStoredAmbientIsDarkMode,
  resolveAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';

describe('readStoredAmbientIsDarkMode', () => {
  it('reads back a persisted flag', () => {
    expect(readStoredAmbientIsDarkMode('true', false)).toBe(true);
    expect(readStoredAmbientIsDarkMode('false', true)).toBe(false);
  });

  it('falls back to system appearance when nothing was persisted', () => {
    expect(readStoredAmbientIsDarkMode(null, true)).toBe(true);
    expect(readStoredAmbientIsDarkMode(null, false)).toBe(false);
    expect(readStoredAmbientIsDarkMode('garbage', true)).toBe(true);
  });
});

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

  it('uses ambient flag in ambient mode', () => {
    expect(resolveThemeIsDarkMode('ambient', false, true)).toBe(true);
    expect(resolveThemeIsDarkMode('ambient', true, false)).toBe(false);
  });
});

describe('nextThemeMode', () => {
  it('cycles Auto → Light → Dark → Auto without ambient', () => {
    expect(nextThemeMode('auto', false)).toBe('light');
    expect(nextThemeMode('light', false)).toBe('dark');
    expect(nextThemeMode('dark', false)).toBe('auto');
  });

  it('includes Ambient Mode when the sensor is available', () => {
    expect(nextThemeMode('auto', true)).toBe('light');
    expect(nextThemeMode('light', true)).toBe('dark');
    expect(nextThemeMode('dark', true)).toBe('ambient');
    expect(nextThemeMode('ambient', true)).toBe('auto');
  });

  it('treats ambient as auto when the sensor is unavailable', () => {
    expect(nextThemeMode('ambient', false)).toBe('light');
  });
});

describe('isValidThemeMode', () => {
  it('accepts known modes including ambient', () => {
    expect(isValidThemeMode('auto')).toBe(true);
    expect(isValidThemeMode('light')).toBe(true);
    expect(isValidThemeMode('dark')).toBe(true);
    expect(isValidThemeMode('ambient')).toBe(true);
    expect(isValidThemeMode('night')).toBe(false);
    expect(isValidThemeMode(null)).toBe(false);
  });
});
