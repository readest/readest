/**
 * The "Apply to every occurrence in the book" toggle in the highlight options
 * showed its state only through `not-eink:text-primary`. On e-ink,
 * `eink-bordered` paints the chip base-100 with a 1px base-content border and
 * `[data-eink='true'] button` flattens the icon to base-content, so on and off
 * rendered identically (#6923). On e-ink the active toggle is inverted like
 * the app's other solid e-ink states.
 *
 * Assert resolved colors with the real stylesheet, not class strings: the
 * defect is which rule wins the cascade.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

await import('@/styles/globals.css');

let mockIsEink = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'highlight' as const,
        highlightStyles: { highlight: 'yellow', underline: 'red', squiggly: 'blue' },
        customHighlightColors: {} as Record<string, string>,
        userHighlightColors: [],
        defaultHighlightLabels: {},
      },
      get globalViewSettings() {
        return { isEink: mockIsEink, isColorEink: false };
      },
    },
  }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHighlightColorLabel: () => undefined,
}));

import HighlightOptions from '@/app/reader/components/annotator/HighlightOptions';

afterEach(() => {
  cleanup();
  mockIsEink = false;
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

const measure = (eink: boolean, active: boolean) => {
  mockIsEink = eink;
  document.documentElement.setAttribute('data-theme', 'default-light');
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  const { getByRole, unmount } = render(
    <div style={{ position: 'relative', width: 300, height: 100 }}>
      <HighlightOptions
        isVertical={false}
        popupWidth={300}
        popupHeight={44}
        triangleDir='up'
        selectedStyle='highlight'
        selectedColor='yellow'
        onHandleHighlight={vi.fn()}
        globalToggleAvailable
        globalToggleActive={active}
      />
    </div>,
  );
  const style = getComputedStyle(
    getByRole('button', { name: 'Apply to every occurrence in the book' }),
  );
  const result = { bg: style.backgroundColor, ink: style.color };
  unmount();
  document.documentElement.removeAttribute('data-eink');
  return result;
};

describe('global highlight toggle state on e-ink (#6923)', () => {
  it('renders on and off differently on e-ink', () => {
    const off = measure(true, false);
    const on = measure(true, true);

    expect(on.bg).not.toBe(off.bg);
    expect(on.ink).not.toBe(off.ink);
  });

  it('inverts the active toggle: base-content fill, base-100 ink', () => {
    const off = measure(true, false);
    const on = measure(true, true);

    expect(on.bg).toBe(off.ink);
    expect(on.ink).toBe(off.bg);
  });

  it('keeps the chip and the primary-colored icon off e-ink', () => {
    const off = measure(false, false);
    const on = measure(false, true);

    expect(on.bg).toBe(off.bg);
    expect(on.ink).not.toBe(off.ink);
  });
});
