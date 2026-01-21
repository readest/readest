import type { Config } from 'tailwindcss';
import { themes } from './src/styles/themes';
import daisyui from 'daisyui';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    { pattern: /bg-./ },
    { pattern: /text-./ },
    { pattern: /fill-./ },
    { pattern: /decoration-./ },
    { pattern: /tooltip-./ },
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [
    daisyui,
    typography,
    plugin(function ({ addVariant }) {
      addVariant('eink', 'html[data-eink="true"] &');
      addVariant('not-eink', 'html:not([data-eink="true"]) &');
    }),
  ],
  daisyui: {
    themes: themes.reduce(
      (acc, { name, colors }) => {
        acc.push({
          [`${name}-light`]: colors.light,
        });
        acc.push({
          [`${name}-dark`]: colors.dark,
        });
        return acc;
      },
      ['light', 'dark'] as (Record<string, unknown> | string)[],
    ),
  },
};
export default config;
