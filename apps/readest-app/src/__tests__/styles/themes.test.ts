import { describe, it, expect, beforeAll } from 'vitest';
import {
  hexToOklch,
  getContrastOklch,
  getContrastHex,
  generateLightPalette,
  generateDarkPalette,
  type BaseColor,
  type Palette,
} from '@/styles/themes';
import tinycolor from 'tinycolor2';

describe('hexToOklch', () => {
  it('should convert red (#ff0000) to oklch string', () => {
    const result = hexToOklch('#ff0000');
    // Red in oklch should have high lightness, high chroma, hue around 29deg
    expect(result).toMatch(/^\d+\.\d+%\s+[\d.]+\s+[\d.]+deg$/);
    const parts = result.split(/[\s%]+/);
    const lightness = parseFloat(parts[0]!);
    expect(lightness).toBeGreaterThan(50);
    expect(lightness).toBeLessThan(70);
  });

  it('should convert black (#000000) to oklch with 0% lightness', () => {
    const result = hexToOklch('#000000');
    expect(result).toMatch(/^0\.0000%\s+0\s+0deg$/);
  });

  it('should convert white (#ffffff) to oklch with ~100% lightness', () => {
    const result = hexToOklch('#ffffff');
    expect(result).toMatch(/^100\.0000%\s+0\s+0deg$/);
  });

  it('should produce achromatic output for gray colors', () => {
    const result = hexToOklch('#808080');
    // Gray should have very low chroma
    const parts = result.split(/[\s%]+/);
    const chroma = parseFloat(parts[1]!);
    expect(chroma).toBeLessThan(0.001);
  });
});

describe('getContrastHex', () => {
  it('should return white for dark colors', () => {
    expect(getContrastHex('#000000').toLowerCase()).toBe('#ffffff');
    expect(getContrastHex('#333333').toLowerCase()).toBe('#ffffff');
    expect(getContrastHex('#1a1a2e').toLowerCase()).toBe('#ffffff');
  });

  it('should return black for light colors', () => {
    expect(getContrastHex('#ffffff').toLowerCase()).toBe('#000000');
    expect(getContrastHex('#f0f0f0').toLowerCase()).toBe('#000000');
    expect(getContrastHex('#e0e0e0').toLowerCase()).toBe('#000000');
  });
});

describe('getContrastOklch', () => {
  it('should return white oklch (100% 0 0deg) for dark colors', () => {
    expect(getContrastOklch('#000000')).toBe('100% 0 0deg');
    expect(getContrastOklch('#333333')).toBe('100% 0 0deg');
  });

  it('should return black oklch (0% 0 0deg) for light colors', () => {
    expect(getContrastOklch('#ffffff')).toBe('0% 0 0deg');
    expect(getContrastOklch('#f0f0f0')).toBe('0% 0 0deg');
  });
});

describe('generateLightPalette', () => {
  const lightColors: BaseColor = {
    bg: '#ffffff',
    fg: '#171717',
    primary: '#0066cc',
  };

  let palette: Palette;

  beforeAll(() => {
    palette = generateLightPalette(lightColors);
  });

  it('should return a palette with all expected keys', () => {
    const expectedKeys = [
      'base-100',
      'base-200',
      'base-300',
      'base-content',
      'neutral',
      'neutral-content',
      'primary',
      'secondary',
      'accent',
    ];
    for (const key of expectedKeys) {
      expect(palette).toHaveProperty(key);
    }
  });

  it('should have base-100 equal to the bg color', () => {
    expect(palette['base-100']).toBe(lightColors.bg);
  });

  it('should have base-100 as a light color', () => {
    expect(tinycolor(palette['base-100']).isLight()).toBe(true);
  });

  it('should have base-content equal to the fg color', () => {
    expect(palette['base-content']).toBe(lightColors.fg);
  });

  it('should have primary equal to the provided primary color', () => {
    expect(palette.primary).toBe(lightColors.primary);
  });

  it('should have base-200 darker than base-100', () => {
    const lum100 = tinycolor(palette['base-100']).getLuminance();
    const lum200 = tinycolor(palette['base-200']).getLuminance();
    expect(lum200).toBeLessThan(lum100);
  });

  it('should have base-300 darker than base-200', () => {
    const lum200 = tinycolor(palette['base-200']).getLuminance();
    const lum300 = tinycolor(palette['base-300']).getLuminance();
    expect(lum300).toBeLessThan(lum200);
  });
});

describe('generateDarkPalette', () => {
  const darkColors: BaseColor = {
    bg: '#222222',
    fg: '#e0e0e0',
    primary: '#77bbee',
  };

  let palette: Palette;

  beforeAll(() => {
    palette = generateDarkPalette(darkColors);
  });

  it('should return a palette with all expected keys', () => {
    const expectedKeys = [
      'base-100',
      'base-200',
      'base-300',
      'base-content',
      'neutral',
      'neutral-content',
      'primary',
      'secondary',
      'accent',
    ];
    for (const key of expectedKeys) {
      expect(palette).toHaveProperty(key);
    }
  });

  it('should have base-100 equal to the bg color', () => {
    expect(palette['base-100']).toBe(darkColors.bg);
  });

  it('should have base-100 as a dark color', () => {
    expect(tinycolor(palette['base-100']).isDark()).toBe(true);
  });

  it('should have base-content equal to the fg color', () => {
    expect(palette['base-content']).toBe(darkColors.fg);
  });

  it('should have primary equal to the provided primary color', () => {
    expect(palette.primary).toBe(darkColors.primary);
  });

  it('should have base-200 lighter than base-100', () => {
    const lum100 = tinycolor(palette['base-100']).getLuminance();
    const lum200 = tinycolor(palette['base-200']).getLuminance();
    expect(lum200).toBeGreaterThan(lum100);
  });

  it('should have base-300 lighter than base-200', () => {
    const lum200 = tinycolor(palette['base-200']).getLuminance();
    const lum300 = tinycolor(palette['base-300']).getLuminance();
    expect(lum300).toBeGreaterThan(lum200);
  });
});

describe('palette contrast', () => {
  it('should have light palette primary-content contrast with primary', () => {
    const palette = generateLightPalette({
      bg: '#ffffff',
      fg: '#171717',
      primary: '#0066cc',
    });
    // Primary is a medium-dark blue, so getContrastHex should return white
    const contrastHex = getContrastHex(palette.primary);
    const primaryDark = tinycolor(palette.primary).isDark();
    if (primaryDark) {
      expect(contrastHex.toLowerCase()).toBe('#ffffff');
    } else {
      expect(contrastHex.toLowerCase()).toBe('#000000');
    }
  });

  it('should have dark palette primary-content contrast with primary', () => {
    const palette = generateDarkPalette({
      bg: '#222222',
      fg: '#e0e0e0',
      primary: '#77bbee',
    });
    const contrastHex = getContrastHex(palette.primary);
    const primaryDark = tinycolor(palette.primary).isDark();
    if (primaryDark) {
      expect(contrastHex.toLowerCase()).toBe('#ffffff');
    } else {
      expect(contrastHex.toLowerCase()).toBe('#000000');
    }
  });
});
