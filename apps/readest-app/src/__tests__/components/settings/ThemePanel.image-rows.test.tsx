// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type HighlightColorsEditor from '@/components/settings/theme/HighlightColorsEditor';
import type { ComponentProps } from 'react';

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
vi.mock('@/components/settings/theme/HighlightColorsEditor', () => ({
  default: ({
    onCustomHighlightColorsChange,
    onUserHighlightColorsChange,
    onDefaultHighlightLabelsChange,
  }: ComponentProps<typeof HighlightColorsEditor>) => (
    <button
      onClick={() => {
        onCustomHighlightColorsChange({ ...HIGHLIGHT_COLOR_HEX, red: '#123456' });
        onUserHighlightColorsChange([{ hex: '#abcdef' }]);
        onDefaultHighlightLabelsChange({ red: 'Important' });
      }}
    >
      Update palette
    </button>
  ),
}));
vi.mock('@/components/settings/theme/CodeHighlightingSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/DialogueHighlightSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ReadingRulerSettings', () => ({ default: () => null }));

import ThemePanel from '@/components/settings/ThemePanel';

const initialStore = useSettingsStore.getInitialState();

const initSettings = () => {
  const settings = {
    globalViewSettings: {},
    globalReadSettings: { customHighlightColors: HIGHLIGHT_COLOR_HEX },
  } as SystemSettings;
  useSettingsStore.setState({ settings, saveSettings: vi.fn() });
  return settings;
};

afterEach(() => {
  cleanup();
  useSettingsStore.setState(initialStore, true);
});

describe('ThemePanel image rows (#7292)', () => {
  it('renders the transparent-background row as a plain one-line row like its siblings', () => {
    initSettings();
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

it('publishes each highlight settings edit to store subscribers (#7490)', () => {
  const initial = initSettings();
  const { saveSettings } = useSettingsStore.getState();
  const onSettingsChange = vi.fn();
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.settings.globalReadSettings !== previous.settings.globalReadSettings) {
      onSettingsChange(state.settings);
    }
  });

  try {
    render(<ThemePanel bookKey='' onRegisterReset={vi.fn()} />);
    onSettingsChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Update palette' }));

    expect(onSettingsChange).toHaveBeenCalledTimes(3);
    const current = useSettingsStore.getState().settings;
    expect(current.globalReadSettings).toEqual({
      customHighlightColors: { ...HIGHLIGHT_COLOR_HEX, red: '#123456' },
      userHighlightColors: [{ hex: '#abcdef' }],
      defaultHighlightLabels: { red: 'Important' },
    });
    expect(initial.globalReadSettings).toEqual({ customHighlightColors: HIGHLIGHT_COLOR_HEX });
    expect(saveSettings).toHaveBeenLastCalledWith(expect.anything(), current);
  } finally {
    unsubscribe();
  }
});
