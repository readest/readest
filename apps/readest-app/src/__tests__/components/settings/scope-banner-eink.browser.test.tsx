/**
 * The design of the scope banner holds one statement: colour is never the only
 * signal. The banner must thus stay clear on an e-ink screen, where each tint
 * becomes flat. The unit tests cannot show this, because vitest does not
 * calculate CSS. This test measures it in a browser.
 *
 * It imports the class strings from the component, and does not copy them. A
 * removal of `eink-bordered` from the chassis thus makes this test fail. This
 * test renders its own elements, so it cannot see a move of that class to
 * another element. `scopeWiring.test.ts` and the banner unit test guard that
 * move. On e-ink the class removes BOTH the tint AND the 4px inline-start edge.
 * One 1px base-content border on base-100 stays. That result is intended,
 * because it makes the icon and the words carry the scope.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  SCOPE_BANNER_BOOK_TINT,
  SCOPE_BANNER_CHASSIS,
  SCOPE_BANNER_GLOBAL_TINT,
} from '@/components/settings/SettingsScopeBanner';
import { themes } from '@/styles/themes';

await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

const measure = (theme: string, eink: boolean) => {
  document.documentElement.setAttribute('data-theme', theme);
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  const { container } = render(
    <>
      {/* The banner in each scope, with the classes that it really holds. */}
      <div data-testid='global' className={`${SCOPE_BANNER_CHASSIS} ${SCOPE_BANNER_GLOBAL_TINT}`} />
      <div data-testid='book' className={`${SCOPE_BANNER_CHASSIS} ${SCOPE_BANNER_BOOK_TINT}`} />
    </>,
  );
  const read = (id: string) => {
    const s = getComputedStyle(container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!);
    return {
      bg: s.backgroundColor,
      border: s.borderInlineStartColor,
      width: s.borderInlineStartWidth,
    };
  };
  return { global: read('global'), book: read('book') };
};

// `STATE_COLORS` sets the info and warning colours for every theme, so neither
// tint changes with the theme. The two tests below compare the scopes inside one
// theme, and one theme is thus enough for them. The last test carries the one
// result that does depend on the theme.
const THEME = 'default-light';
const OTHER_THEME = 'default-dark';

describe('the scope banner on e-ink', () => {
  it('shows two different tints on a normal screen', () => {
    const { global, book } = measure(THEME, false);

    expect(global.bg).not.toBe(book.bg);
    expect(global.border).not.toBe(book.border);
    // The design uses this strong inline-start bar.
    expect(global.width).toBe('4px');
  });

  it('flattens both scopes to the same surface on e-ink', () => {
    const { global, book } = measure(THEME, true);

    // This is the result: the tint is gone. Only the icon and the words then
    // separate the two states.
    expect(global.bg).toBe(book.bg);
    expect(global.border).toBe(book.border);
    expect(global.width).toBe('1px');
  });

  it('takes the flat e-ink surface from the theme', () => {
    // `eink-bordered` sets the surface to `base-100`, which each theme defines.
    // A wrong theme name falls back to a palette that is still different, so the
    // colour test alone cannot find one. Check the names against `themes.ts`.
    // `applyDataTheme` builds the attribute as `<name>-<light|dark>`.
    const known = themes.map((theme) => theme.name);
    for (const theme of [THEME, OTHER_THEME]) {
      expect(known, `${theme} names no theme in themes.ts`).toContain(
        theme.slice(0, theme.lastIndexOf('-')),
      );
      expect(['light', 'dark'], `${theme} names no colour scheme`).toContain(
        theme.split('-').pop(),
      );
    }

    const first = measure(THEME, true).global.bg;
    cleanup();
    document.documentElement.removeAttribute('data-eink');
    document.documentElement.removeAttribute('data-theme');
    const second = measure(OTHER_THEME, true).global.bg;

    expect(first).not.toBe(second);
  });
});
