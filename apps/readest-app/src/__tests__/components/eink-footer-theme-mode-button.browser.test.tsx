/**
 * The light/dark button at the end of the footer's Color row previews the
 * theme's dark palette in every mode. On e-ink, `[data-eink='true'] button`
 * forces its icon to the current base-content, so in light mode the icon was
 * dark on dark and could not be seen.
 *
 * Assert resolved colors with the real stylesheet, not class strings: the
 * defect is which rule wins the cascade.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import tinycolor from 'tinycolor2';

import { ColorPanel } from '@/app/reader/components/footerbar/ColorPanel';

await import('@/styles/globals.css');

const theme = vi.hoisted(() => ({
  themeMode: 'light',
  themeColor: 'default',
  isDarkMode: false,
  setThemeMode: () => {},
  setThemeColor: () => {},
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { screenBrightness: -1, globalReadSettings: { customThemes: [] } },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    getScreenBrightness: async () => -1,
    setScreenBrightness: async () => {},
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => theme,
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

const measure = (mode: 'light' | 'dark', eink: boolean) => {
  theme.themeMode = mode;
  theme.isDarkMode = mode === 'dark';
  document.documentElement.setAttribute('data-theme', `default-${mode}`);
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  const { container } = render(
    <ColorPanel actionTab='color' bottomOffset='0px' forceMobileLayout />,
  );
  const buttons = container.querySelectorAll('button');
  const modeButton = buttons[buttons.length - 1]!;
  const bg = getComputedStyle(modeButton).backgroundColor;
  const icon = getComputedStyle(modeButton.querySelector('svg')!).color;
  return { bg, contrast: tinycolor.readability(bg, icon) };
};

describe('footer light/dark button on e-ink', () => {
  it('keeps its icon readable in light mode', () => {
    expect(measure('light', true).contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps its icon readable in dark mode', () => {
    expect(measure('dark', true).contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('still previews the dark palette off e-ink', () => {
    expect(measure('light', false).bg).toBe('rgb(34, 34, 34)');
  });
});
