import tinycolor from 'tinycolor2';

export type BaseColor = {
  bg: string;
  fg: string;
  primary: string;
};

/** `ambient` follows the ambient light sensor (lux → light/dark), Android-first. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'ambient';

/**
 * Which page's theme is being read or written (issue #5945). The library and
 * the reader can carry different theme modes and colors; every route that is
 * not the reader resolves as 'library'.
 */
export type ThemeScope = 'library' | 'reader';

export type Palette = {
  'base-100': string;
  'base-200': string;
  'base-300': string;
  'base-content': string;
  neutral: string;
  'neutral-content': string;
  primary: string;
  secondary: string;
  accent: string;
};

export type Theme = {
  name: string;
  label: string;
  colors: {
    light: Palette;
    dark: Palette;
  };
  isCustomizable?: boolean;
};

export type CustomTheme = {
  name: string;
  label: string;
  colors: {
    light: BaseColor;
    dark: BaseColor;
  };
};

export type ColorScheme = 'light' | 'dark';

export const getContrastHex = (hexColor: string): string => {
  return tinycolor(hexColor).isDark() ? '#FFFFFF' : '#000000';
};

// daisyUI 4 derived every `*-content` color by mixing 80% toward whichever of
// white/black contrasts better; keep that so primary buttons, badges and
// tooltips read exactly as they did before the daisyUI 5 upgrade.
const contentColorFor = (hexColor: string): string => {
  const towardWhite =
    tinycolor.readability(hexColor, '#000000') < tinycolor.readability(hexColor, '#ffffff');
  return tinycolor.mix(hexColor, towardWhite ? '#ffffff' : '#000000', 80).toHexString();
};

// daisyUI 4's defaults for themes that leave the state colors unset, and the
// content colors it derived from them.
const STATE_COLORS = {
  info: ['oklch(72.06% 0.191 231.6)', 'oklch(14.412% 0.0382 231.6)'],
  success: ['oklch(64.8% 0.15 160)', 'oklch(12.96% 0.03 160)'],
  warning: ['oklch(84.71% 0.199 83.87)', 'oklch(16.942% 0.0398 83.87)'],
  error: ['oklch(71.76% 0.221 22.18)', 'oklch(14.352% 0.0442 22.18)'],
} as const;

/**
 * daisyUI 5 theme tokens for a palette. Shared by the build-time plugin that
 * compiles the built-in themes (daisyui-themes.ts) and by `applyCustomTheme`,
 * which injects custom themes at runtime, so both paths render identically.
 * The radius/depth tokens pin daisyUI 4's shape: 0.5rem fields, 1rem boxes,
 * pill badges and toggles, and no faux-3D shading.
 */
export const themeVariables = (palette: Palette, scheme: ColorScheme): Record<string, string> => ({
  'color-scheme': scheme,
  '--color-base-100': palette['base-100'],
  '--color-base-200': palette['base-200'],
  '--color-base-300': palette['base-300'],
  '--color-base-content': palette['base-content'],
  '--color-primary': palette.primary,
  '--color-primary-content': contentColorFor(palette.primary),
  '--color-secondary': palette.secondary,
  '--color-secondary-content': contentColorFor(palette.secondary),
  '--color-accent': palette.accent,
  '--color-accent-content': contentColorFor(palette.accent),
  '--color-neutral': palette.neutral,
  '--color-neutral-content': palette['neutral-content'],
  '--color-info': STATE_COLORS.info[0],
  '--color-info-content': STATE_COLORS.info[1],
  '--color-success': STATE_COLORS.success[0],
  '--color-success-content': STATE_COLORS.success[1],
  '--color-warning': STATE_COLORS.warning[0],
  '--color-warning-content': STATE_COLORS.warning[1],
  '--color-error': STATE_COLORS.error[0],
  '--color-error-content': STATE_COLORS.error[1],
  '--radius-selector': '1.9rem',
  '--radius-field': '0.5rem',
  '--radius-box': '1rem',
  '--size-selector': '0.25rem',
  '--size-field': '0.25rem',
  '--border': '1px',
  '--depth': '0',
  '--noise': '0',
});

export const generateLightPalette = ({ bg, fg, primary }: BaseColor) => {
  return {
    'base-100': bg, // Main background
    'base-200': tinycolor(bg).darken(5).toHexString(), // Slightly darker
    'base-300': tinycolor(bg).darken(12).toHexString(), // More darker
    'base-content': fg, // Main text color
    neutral: tinycolor(bg).darken(15).desaturate(20).toHexString(), // Muted neutral
    'neutral-content': tinycolor(fg).lighten(20).desaturate(20).toHexString(), // Slightly lighter text
    primary: primary,
    secondary: tinycolor(primary).lighten(20).toHexString(), // Lighter secondary
    accent: tinycolor(primary).analogous()[1]!.toHexString(), // Analogous accent
  } as Palette;
};

export const generateDarkPalette = ({ bg, fg, primary }: BaseColor) => {
  return {
    'base-100': bg, // Main background
    'base-200': tinycolor(bg).lighten(5).toHexString(), // Slightly lighter
    'base-300': tinycolor(bg).lighten(12).toHexString(), // More lighter
    'base-content': fg, // Main text color
    neutral: tinycolor(bg).lighten(15).desaturate(20).toHexString(), // Muted neutral
    'neutral-content': tinycolor(fg).darken(20).desaturate(20).toHexString(), // Darkened text
    primary: primary,
    secondary: tinycolor(primary).darken(20).toHexString(), // Darker secondary
    accent: tinycolor(primary).triad()[1]!.toHexString(), // Triad accent
  } as Palette;
};

const _ = (stubKey: string) => stubKey;

export const themes = [
  {
    name: 'default',
    label: _('Default'),
    colors: {
      light: generateLightPalette({ fg: '#171717', bg: '#ffffff', primary: '#0066cc' }),
      dark: generateDarkPalette({ fg: '#e0e0e0', bg: '#222222', primary: '#77bbee' }),
    },
  },
  {
    name: 'gray',
    label: _('Gray'),
    colors: {
      light: generateLightPalette({ fg: '#222222', bg: '#e0e0e0', primary: '#4488cc' }),
      dark: generateDarkPalette({ fg: '#c6c6c6', bg: '#444444', primary: '#88ccee' }),
    },
  },
  {
    name: 'sepia',
    label: _('Sepia'),
    colors: {
      light: generateLightPalette({ fg: '#5b4636', bg: '#f1e8d0', primary: '#008b8b' }),
      dark: generateDarkPalette({ fg: '#ffd595', bg: '#342e25', primary: '#48d1cc' }),
    },
  },
  {
    name: 'grass',
    label: _('Grass'),
    colors: {
      light: generateLightPalette({ fg: '#232c16', bg: '#d7dbbd', primary: '#177b4d' }),
      dark: generateDarkPalette({ fg: '#d8deba', bg: '#333627', primary: '#a6d608' }),
    },
  },
  {
    name: 'cherry',
    label: _('Cherry'),
    colors: {
      light: generateLightPalette({ fg: '#4e1609', bg: '#f0d1d5', primary: '#de3838' }),
      dark: generateDarkPalette({ fg: '#e5c4c8', bg: '#462f32', primary: '#ff646e' }),
    },
  },
  {
    name: 'sky',
    label: _('Sky'),
    colors: {
      light: generateLightPalette({ fg: '#262d48', bg: '#cedef5', primary: '#2d53e5' }),
      dark: generateDarkPalette({ fg: '#babee1', bg: '#282e47', primary: '#ff646e' }),
    },
  },
  {
    name: 'solarized',
    label: _('Solarized'),
    colors: {
      light: generateLightPalette({ fg: '#586e75', bg: '#fdf6e3', primary: '#268bd2' }),
      dark: generateDarkPalette({ fg: '#93a1a1', bg: '#002b36', primary: '#268bd2' }),
    },
  },
  {
    name: 'gruvbox',
    label: _('Gruvbox'),
    colors: {
      light: generateLightPalette({ fg: '#3c3836', bg: '#fbf1c7', primary: '#076678' }),
      dark: generateDarkPalette({ fg: '#ebdbb2', bg: '#282828', primary: '#83a598' }),
    },
  },
  {
    name: 'nord',
    label: _('Nord'),
    colors: {
      light: generateLightPalette({ fg: '#2e3440', bg: '#eceff4', primary: '#5e81ac' }),
      dark: generateDarkPalette({ fg: '#d8dee9', bg: '#2e3440', primary: '#88c0d0' }),
    },
  },
  {
    name: 'contrast',
    label: _('Contrast'),
    colors: {
      light: generateLightPalette({ fg: '#000000', bg: '#ffffff', primary: '#4488cc' }),
      dark: generateDarkPalette({ fg: '#ffffff', bg: '#000000', primary: '#88ccee' }),
    },
  },
  {
    name: 'sunset',
    label: _('Sunset'),
    colors: {
      light: generateLightPalette({ fg: '#423126', bg: '#fff7f0', primary: '#fe6b64' }),
      dark: generateDarkPalette({ fg: '#f6e1d7', bg: '#3c2b25', primary: '#ff9c94' }),
    },
  },
] as Theme[];

const themeBlock = (name: string, palette: Palette, scheme: ColorScheme): string => {
  const declarations = Object.entries(themeVariables(palette, scheme))
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
  return `[data-theme="${name}"] {\n${declarations}\n}`;
};

export const applyCustomTheme = (customTheme: CustomTheme) => {
  const light = `${customTheme.name}-light`;
  const dark = `${customTheme.name}-dark`;
  const css = [
    themeBlock(light, generateLightPalette(customTheme.colors.light), 'light'),
    themeBlock(dark, generateDarkPalette(customTheme.colors.dark), 'dark'),
  ].join('\n');

  const id = `theme-${customTheme.name}-styles`;
  document.getElementById(id)?.remove();
  const styleElement = document.createElement('style');
  styleElement.id = id;
  styleElement.textContent = css;
  document.head.appendChild(styleElement);

  return { light, dark };
};
