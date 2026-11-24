// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColorPanel } from '@/app/reader/components/footerbar/ColorPanel';
import type { CustomTheme } from '@/styles/themes';

const paper: CustomTheme = {
  name: 'a1b2c3',
  label: 'Paper',
  colors: {
    light: { bg: '#f4ecd8', fg: '#3b3024', primary: '#8a5a2b' },
    dark: { bg: '#1e1b16', fg: '#d8cbb0', primary: '#c08a4a' },
  },
};

const theme = vi.hoisted(() => ({
  themeMode: 'light',
  themeColor: 'default',
  isDarkMode: false,
  setThemeMode: vi.fn(),
  setThemeColor: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { screenBrightness: -1, globalReadSettings: { customThemes: [paper] } },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    getScreenBrightness: vi.fn(),
    setScreenBrightness: vi.fn(),
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => theme,
}));

const renderPanel = () =>
  render(<ColorPanel actionTab='color' bottomOffset='0px' forceMobileLayout />);

// The footer's Color panel listed only the built-in themes, so a custom theme
// could be picked only from Settings (#7481).
describe('footer Color panel custom themes (#7481)', () => {
  afterEach(() => {
    cleanup();
    theme.themeColor = 'default';
    theme.themeMode = 'light';
    theme.setThemeColor.mockReset();
  });

  it('lists custom themes after the built-in ones and selects them', () => {
    renderPanel();
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels.indexOf('Paper')).toBeGreaterThan(labels.indexOf('Default'));

    fireEvent.click(screen.getByRole('button', { name: 'Paper' }));
    expect(theme.setThemeColor).toHaveBeenCalledWith('a1b2c3');
  });

  it('paints a custom theme in its own colors', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Paper' }).style.backgroundColor).toBe('#f4ecd8');
  });

  it('shows the selected custom theme on the dark-mode button', () => {
    theme.themeColor = 'a1b2c3';
    const { container } = renderPanel();
    const buttons = container.querySelectorAll('button');
    const modeButton = buttons[buttons.length - 1]!;
    expect(modeButton.style.backgroundColor).toBe('#1e1b16');
  });
});
