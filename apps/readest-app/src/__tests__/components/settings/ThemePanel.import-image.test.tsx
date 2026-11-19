// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomTextureStore } from '@/store/customTextureStore';
import type { SystemSettings } from '@/types/settings';
import type BackgroundTextureSelector from '@/components/settings/theme/BackgroundTextureSelector';
import type { ComponentProps } from 'react';

/**
 * Issue #7671 (the texture side): a replica pull starts by reloading the
 * texture store from settings, and closing the file picker focuses the window,
 * which triggers one. Images added before it must already be in settings, or
 * the reload drops them while their files and cloud copies stay behind.
 */

const { env, selectFiles } = vi.hoisted(() => ({
  env: { appService: {} as Record<string, unknown>, envConfig: {} as Record<string, unknown> },
  selectFiles: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => env }));
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
vi.mock('@/store/atmosphereStore', () => ({ useAtmosphereStore: () => ({}) }));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useFileSelector', () => ({ useFileSelector: () => ({ selectFiles }) }));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({
  queueReplicaBinaryUpload: vi.fn(),
  queueReplicaBinaryDelete: vi.fn(),
}));
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));
vi.mock('@/components/settings/theme/ThemeEditor', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ThemeModeSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ThemeColorSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/BackgroundTextureSelector', () => ({
  default: ({ onImportImage }: ComponentProps<typeof BackgroundTextureSelector>) => (
    <button onClick={onImportImage}>Import Image</button>
  ),
}));
vi.mock('@/components/settings/theme/HighlightColorsEditor', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/CodeHighlightingSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/DialogueHighlightSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ReadingRulerSettings', () => ({ default: () => null }));

import ThemePanel from '@/components/settings/ThemePanel';

const initialStore = useSettingsStore.getInitialState();

afterEach(() => {
  cleanup();
  useSettingsStore.setState(initialStore, true);
  useCustomTextureStore.setState({ textures: [] });
});

describe('ThemePanel image import (#7671)', () => {
  it('keeps every imported image when a sync pull reloads the store mid-import', async () => {
    const files = ['paper.png', 'linen.png'];
    const appService = {
      importImage: vi.fn(async (file: string) => {
        if (file === files[1]) {
          await useCustomTextureStore.getState().loadCustomTextures(env.envConfig as never);
        }
        const name = file.replace(/\.png$/, '');
        return {
          path: `${name}/${file}`,
          name,
          bundleDir: name,
          contentId: `hash-${name}`,
          byteSize: 4,
        };
      }),
      openFile: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })),
      saveSettings: vi.fn(async () => {}),
    };
    env.appService = appService;
    env.envConfig = { getAppService: async () => appService };
    useSettingsStore.setState({
      settings: {
        globalViewSettings: {},
        globalReadSettings: { customHighlightColors: HIGHLIGHT_COLOR_HEX },
        customTextures: [],
      } as unknown as SystemSettings,
    });
    useCustomTextureStore.setState({ textures: [] });
    selectFiles.mockResolvedValue({ files: files.map((path) => ({ path })) });
    render(<ThemePanel bookKey='' onRegisterReset={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import Image' }));

    await waitFor(() => expect(appService.importImage).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.customTextures?.map((t) => t.name)).toEqual([
        'paper',
        'linen',
      ]),
    );
    expect(useCustomTextureStore.getState().textures.map((t) => t.name)).toEqual([
      'paper',
      'linen',
    ]);
  });
});
