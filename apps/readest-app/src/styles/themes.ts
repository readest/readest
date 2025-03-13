import tinycolor from 'tinycolor2';
import { stubTranslation as _ } from '../utils/misc';
import { getContrastOklch, hexToOklch } from '../utils/color';

export type BaseColor = {
  bg: string;
  fg: string;
  primary: string;
};

export type ThemeMode = 'auto' | 'light' | 'dark';

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
  isCustomizale?: boolean;
};

export type CustomTheme = {
  name: string;
  label: string;
  colors: {
    light: BaseColor;
    dark: BaseColor;
  };
};

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

const generateCustomThemeVariables = (palette: Palette): string => {
  return `
    --b1: ${hexToOklch(palette['base-100'])};
    --b2: ${hexToOklch(palette['base-200'])};
    --b3: ${hexToOklch(palette['base-300'])};
    --bc: ${hexToOklch(palette['base-content'])};
    
    --p: ${hexToOklch(palette.primary)};
    --pc: ${getContrastOklch(palette.primary)};
    
    --s: ${hexToOklch(palette.secondary)};
    --sc: ${getContrastOklch(palette.secondary)};
    
    --a: ${hexToOklch(palette.accent)};
    --ac: ${getContrastOklch(palette.accent)};
    
    --n: ${hexToOklch(palette.neutral)};
    --nc: ${hexToOklch(palette['neutral-content'])};
    
    --in: 69.37% 0.047 231;
    --inc: 100% 0 0;
    --su: 78.15% 0.12 160;
    --suc: 100% 0 0;
    --wa: 90.69% 0.123 84;
    --wac: 0% 0 0;
    --er: 70.9% 0.184 22;
    --erc: 100% 0 0;
  `;
};

export const applyCustomTheme = (customTheme: CustomTheme) => {
  const lightPalette = generateLightPalette(customTheme.colors.light);
  const darkPalette = generateDarkPalette(customTheme.colors.dark);

  const lightThemeName = `${customTheme.name}-light`;
  const darkThemeName = `${customTheme.name}-dark`;

  const css = `
    [data-theme="${lightThemeName}"] {
      ${generateCustomThemeVariables(lightPalette)}
    }
    
    [data-theme="${darkThemeName}"] {
      ${generateCustomThemeVariables(darkPalette)}
    }
    
    :root {
      --${lightThemeName}: 1;
      --${darkThemeName}: 1;
    }
  `;

  const styleElement = document.createElement('style');
  styleElement.id = `theme-${lightThemeName}-styles`;
  styleElement.textContent = css;

  const existingStyle = document.getElementById(styleElement.id);
  if (existingStyle) {
    existingStyle.remove();
  }

  document.head.appendChild(styleElement);

  return {
    light: lightThemeName,
    dark: darkThemeName,
  };
};
