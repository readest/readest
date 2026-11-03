import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * Issue #7292: the image-transparency row sat in its own BoxedList card with a
 * description line, so it showed a shaded box between the plain "Invert Image
 * In Dark Mode" and "Override Book Color" rows around it.
 */

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    isDarkMode: true,
    systemIsDarkMode: true,
    ambientIsDarkMode: false,
    getScopedTheme: () => ({ themeMode: 'dark', themeColor: 'default' }),
    setScopedThemeMode: vi.fn(),
    setScopedThemeColor: vi.fn(),
    resetThemeScopes: vi.fn(),
    saveCustomTheme: vi.fn(),
  }),
}));
vi.mock('@/store/settingsStore', () => {
  const state = {
    settings: { globalViewSettings: {}, globalReadSettings: {} },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/readerStore', () => {
  const state = { bookKeys: [], getView: () => null, getViewSettings: () => null };
  return { useReaderStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: () => ({}) }));
vi.mock('@/store/customTextureStore', () => ({
  useCustomTextureStore: () => ({ textures: [], loadCustomTextures: vi.fn() }),
}));
vi.mock('@/store/atmosphereStore', () => ({ useAtmosphereStore: () => ({}) }));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useFileSelector', () => ({ useFileSelector: () => ({ selectFiles: vi.fn() }) }));
vi.mock('@/components/settings/theme/ThemeEditor', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ThemeModeSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ThemeColorSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/BackgroundTextureSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/HighlightColorsEditor', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/CodeHighlightingSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/DialogueHighlightSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ReadingRulerSettings', () => ({ default: () => null }));

import ThemePanel from '@/components/settings/ThemePanel';

afterEach(() => cleanup());

describe('ThemePanel image rows (#7292)', () => {
  it('renders the transparent-background row as a plain one-line row like its siblings', () => {
    const { container } = render(<ThemePanel bookKey='' onRegisterReset={vi.fn()} />);

    const row = container.querySelector(
      '[data-setting-id="settings.color.transparentImageBackground"]',
    ) as HTMLElement;
    const sibling = container.querySelector(
      '[data-setting-id="settings.color.invertImageInDarkMode"]',
    ) as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.closest('.card')).toBeNull();
    expect(row.parentElement).toBe(sibling.parentElement);
    expect(row.textContent).toBe('Transparent Image Background');
  });
});
