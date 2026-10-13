import plugin from 'tailwindcss/plugin';
import { themes, themeVariables } from './themes';

/**
 * Registers the built-in Readest themes with daisyUI 5. Tailwind 4 is configured
 * from CSS, so globals.css loads this file with `@plugin './daisyui-themes.ts'`;
 * every theme compiles to a `[data-theme="<name>-<light|dark>"]` block carrying
 * the same tokens `applyCustomTheme` injects at runtime for custom themes.
 */
export default plugin(({ addBase }) => {
  addBase(
    Object.fromEntries(
      themes.flatMap(({ name, colors }) => [
        [`[data-theme="${name}-light"]`, themeVariables(colors.light, 'light')],
        [`[data-theme="${name}-dark"]`, themeVariables(colors.dark, 'dark')],
      ]),
    ),
  );
});
