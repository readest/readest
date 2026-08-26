import { describe, it, expect, vi } from 'vitest';
import daisyuiThemes from '@/styles/daisyui-themes';
import { themes, themeVariables } from '@/styles/themes';

/**
 * The built-in Readest themes reach Tailwind through `@plugin './daisyui-themes.ts'`
 * in globals.css (Tailwind 4 has no JS config). Every theme must compile to a
 * `[data-theme="<name>-<scheme>"]` block carrying the same tokens the runtime
 * injector emits for custom themes, so both paths render identically.
 */
describe('daisyui-themes plugin', () => {
  const collect = () => {
    const addBase = vi.fn();
    daisyuiThemes.handler({ addBase } as never);
    return Object.assign({}, ...addBase.mock.calls.map(([styles]) => styles)) as Record<
      string,
      Record<string, string>
    >;
  };

  it('emits a light and a dark block for each built-in theme', () => {
    const base = collect();
    for (const theme of themes) {
      expect(base[`[data-theme="${theme.name}-light"]`]).toEqual(
        themeVariables(theme.colors.light, 'light'),
      );
      expect(base[`[data-theme="${theme.name}-dark"]`]).toEqual(
        themeVariables(theme.colors.dark, 'dark'),
      );
    }
    expect(Object.keys(base)).toHaveLength(themes.length * 2);
  });
});
