import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  getContrastHex,
  generateLightPalette,
  generateDarkPalette,
  themeVariables,
  applyCustomTheme,
  type BaseColor,
  type CustomTheme,
  type Palette,
} from '@/styles/themes';
import tinycolor from 'tinycolor2';

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

describe('themeVariables', () => {
  const palette = generateLightPalette({ bg: '#ffffff', fg: '#171717', primary: '#0066cc' });

  it('emits daisyUI 5 color tokens as plain colors', () => {
    const vars = themeVariables(palette, 'light');
    expect(vars['color-scheme']).toBe('light');
    expect(vars['--color-base-100']).toBe('#ffffff');
    expect(vars['--color-base-200']).toBe(palette['base-200']);
    expect(vars['--color-base-300']).toBe(palette['base-300']);
    expect(vars['--color-base-content']).toBe('#171717');
    expect(vars['--color-primary']).toBe('#0066cc');
    expect(vars['--color-secondary']).toBe(palette.secondary);
    expect(vars['--color-accent']).toBe(palette.accent);
    expect(vars['--color-neutral']).toBe(palette.neutral);
    expect(vars['--color-neutral-content']).toBe(palette['neutral-content']);
    for (const state of ['info', 'success', 'warning', 'error']) {
      expect(vars[`--color-${state}`]).toMatch(/^oklch\(/);
      expect(vars[`--color-${state}-content`]).toMatch(/^oklch\(/);
    }
  });

  it('derives readable *-content colors like daisyUI 4 did (80% toward white or black)', () => {
    const vars = themeVariables(palette, 'light');
    // #0066cc is dark, so its content color leans to white; the accent/secondary
    // of this palette are light, so theirs lean to black.
    expect(tinycolor(vars['--color-primary-content']!).isLight()).toBe(true);
    expect(tinycolor(vars['--color-primary-content']!).toHexString()).not.toBe('#ffffff');
    expect(tinycolor(vars['--color-secondary-content']!).isDark()).toBe(true);
  });

  it('pins the daisyUI 4 shape so components keep their radii and flat look', () => {
    const vars = themeVariables(palette, 'dark');
    expect(vars['color-scheme']).toBe('dark');
    expect(vars['--radius-field']).toBe('0.5rem');
    expect(vars['--radius-box']).toBe('1rem');
    expect(vars['--radius-selector']).toBe('1.9rem');
    expect(vars['--depth']).toBe('0');
    expect(vars['--noise']).toBe('0');
    expect(vars['--border']).toBe('1px');
  });
});

describe('applyCustomTheme', () => {
  const customTheme: CustomTheme = {
    name: 'custom-1',
    label: 'Custom',
    colors: {
      light: { bg: '#fefefe', fg: '#111111', primary: '#0066cc' },
      dark: { bg: '#101010', fg: '#eeeeee', primary: '#77bbee' },
    },
  };

  afterEach(() => {
    document.getElementById('theme-custom-1-styles')?.remove();
  });

  it('injects one [data-theme] block per scheme with daisyUI 5 tokens', () => {
    const names = applyCustomTheme(customTheme);
    expect(names).toEqual({ light: 'custom-1-light', dark: 'custom-1-dark' });
    const style = document.getElementById('theme-custom-1-styles') as HTMLStyleElement;
    expect(style.tagName).toBe('STYLE');
    const css = style.textContent!;
    expect(css).toContain('[data-theme="custom-1-light"]');
    expect(css).toContain('[data-theme="custom-1-dark"]');
    expect(css).toMatch(/custom-1-light"\]\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/custom-1-dark"\]\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/custom-1-light"\]\s*\{[^}]*--color-base-100:\s*#fefefe/);
    expect(css).toMatch(/custom-1-dark"\]\s*\{[^}]*--color-base-100:\s*#101010/);
    expect(css).not.toContain('--b1:');
    expect(css).not.toContain('--fallback-');
  });

  it('replaces the previous style element for the same theme', () => {
    applyCustomTheme(customTheme);
    applyCustomTheme({
      ...customTheme,
      colors: { ...customTheme.colors, light: { ...customTheme.colors.light, bg: '#f0f0f0' } },
    });
    const styles = document.querySelectorAll('#theme-custom-1-styles');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('--color-base-100: #f0f0f0');
  });
});
