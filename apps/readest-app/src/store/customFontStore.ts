import { create } from 'zustand';
import { EnvConfigType } from '@/services/environment';
import { CustomFont, createCustomFont, getFontFormat, getMimeType } from '@/styles/fonts';
import { useSettingsStore } from './settingsStore';

interface FontStoreState {
  fonts: CustomFont[];
  loading: boolean;

  setFonts: (fonts: CustomFont[]) => void;
  addFont: (path: string, options?: Partial<Omit<CustomFont, 'id' | 'path'>>) => CustomFont;
  removeFont: (id: string) => boolean;
  updateFont: (id: string, updates: Partial<CustomFont>) => boolean;
  getFont: (id: string) => CustomFont | undefined;
  getAllFonts: () => CustomFont[];
  getAvailableFonts: () => CustomFont[];
  clearAllFonts: () => void;

  loadFont: (envConfig: EnvConfigType, fontId: string) => Promise<CustomFont>;
  loadFonts: (envConfig: EnvConfigType, fontIds: string[]) => Promise<CustomFont[]>;
  loadAllFonts: (envConfig: EnvConfigType) => Promise<CustomFont[]>;
  unloadFont: (fontId: string) => boolean;
  unloadAllFonts: () => void;

  getFontFamilies: () => string[];
  getLoadedFonts: () => CustomFont[];
  isFontLoaded: (fontId: string) => boolean;

  loadCustomFonts: (envConfig: EnvConfigType) => Promise<void>;
  saveCustomFonts: (envConfig: EnvConfigType) => Promise<void>;
}

function toSettingsFont(font: CustomFont): CustomFont {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { blobUrl, loaded, error, ...settingsFont } = font;
  return settingsFont;
}

export const useCustomFontStore = create<FontStoreState>((set, get) => ({
  fonts: [],
  loading: false,

  setFonts: (fonts) => set({ fonts }),
  addFont: (path, options) => {
    const font = createCustomFont(path, options);
    const existingFont = get().fonts.find((f) => f.id === font.id);
    if (existingFont) {
      get().updateFont(font.id, {
        ...font,
        path: font.path,
        downloadedAt: Date.now(),
        deletedAt: undefined,
        loaded: false,
        blobUrl: undefined,
        error: undefined,
      });
      set((state) => ({
        fonts: [...state.fonts],
      }));
      return existingFont;
    }

    const newFont = {
      ...font,
      downloadedAt: Date.now(),
    };

    set((state) => ({
      fonts: [...state.fonts, newFont],
    }));

    return newFont;
  },

  removeFont: (id) => {
    const font = get().getFont(id);
    if (!font) return false;

    if (font.blobUrl) {
      URL.revokeObjectURL(font.blobUrl);
    }

    const result = get().updateFont(id, {
      deletedAt: Date.now(),
      blobUrl: undefined,
      loaded: false,
      error: undefined,
    });
    set((state) => ({
      fonts: [...state.fonts],
    }));
    return result;
  },

  updateFont: (id, updates) => {
    const state = get();
    const fontIndex = state.fonts.findIndex((font) => font.id === id);

    if (fontIndex === -1) return false;

    set((state) => ({
      fonts: state.fonts.map((font, index) =>
        index === fontIndex ? { ...font, ...updates } : font,
      ),
    }));

    return true;
  },

  getFont: (id) => {
    return get().fonts.find((font) => font.id === id);
  },

  getAllFonts: () => {
    return get().fonts;
  },

  getAvailableFonts: () => {
    return get().fonts.filter((font) => !font.deletedAt);
  },

  clearAllFonts: () => {
    const { fonts } = get();
    fonts.forEach((font) => {
      if (font.blobUrl) {
        URL.revokeObjectURL(font.blobUrl);
      }
    });

    set({ fonts: [] });
  },

  loadFont: async (envConfig, fontId) => {
    const font = get().getFont(fontId);

    if (!font) {
      throw new Error(`Font with id "${fontId}" not found`);
    }

    if (font.deletedAt) {
      throw new Error(`Font "${font.name}" has been deleted`);
    }

    if (font.loaded && font.blobUrl && !font.error) {
      return font;
    }

    try {
      get().updateFont(fontId, {
        loaded: false,
        error: undefined,
      });

      const appService = await envConfig.getAppService();
      const fontFile = await appService.openFile(font.path, 'Fonts');

      const format = getFontFormat(font.path);
      const mimeType = getMimeType(format);
      const blob = new Blob([await fontFile.arrayBuffer()], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      get().updateFont(fontId, {
        blobUrl,
        loaded: true,
        error: undefined,
      });

      const updatedFont = get().getFont(fontId)!;
      return updatedFont;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      get().updateFont(fontId, {
        loaded: false,
        error: errorMessage,
        blobUrl: undefined,
      });

      throw error;
    }
  },

  loadFonts: async (envConfig, fontIds) => {
    set({ loading: true });
    try {
      const results = await Promise.allSettled(fontIds.map((id) => get().loadFont(envConfig, id)));

      return results
        .filter(
          (result): result is PromiseFulfilledResult<CustomFont> => result.status === 'fulfilled',
        )
        .map((result) => result.value);
    } finally {
      set({ loading: false });
    }
  },

  loadAllFonts: async (envConfig) => {
    const fontIds = get()
      .getAvailableFonts()
      .map((font) => font.id);
    return await get().loadFonts(envConfig, fontIds);
  },

  unloadFont: (fontId) => {
    const font = get().getFont(fontId);

    if (font?.blobUrl) {
      URL.revokeObjectURL(font.blobUrl);
    }

    return get().updateFont(fontId, {
      blobUrl: undefined,
      loaded: false,
      error: undefined,
    });
  },

  unloadAllFonts: () => {
    const fonts = get().getAllFonts();

    fonts.forEach((font) => {
      if (font.blobUrl) {
        URL.revokeObjectURL(font.blobUrl);
      }
    });

    fonts.forEach((font) => {
      get().updateFont(font.id, {
        blobUrl: undefined,
        loaded: false,
        error: undefined,
      });
    });
  },

  getFontFamilies: () => {
    return get()
      .getAvailableFonts()
      .filter((font) => font.loaded && !font.error)
      .map((font) => font.family || font.name)
      .filter((value, index, self) => self.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
  },

  getLoadedFonts: () => {
    return get()
      .getAvailableFonts()
      .filter((font) => font.loaded && !font.error);
  },

  isFontLoaded: (fontId) => {
    const font = get().getFont(fontId);
    return font?.loaded === true && !font.error && !font.deletedAt;
  },

  loadCustomFonts: async (envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const currentFonts = get().fonts;
      if (settings?.customFonts) {
        const fonts = settings.customFonts.map((font) => {
          const existingFont = currentFonts.find((f) => f.id === font.id);
          return {
            ...font,
            loaded: existingFont?.loaded || false,
            error: existingFont?.error,
            blobUrl: existingFont?.blobUrl,
          };
        });
        set({ fonts });
        await get().loadAllFonts(envConfig);
      }
    } catch (error) {
      console.error('Failed to load custom fonts settings:', error);
    }
  },

  saveCustomFonts: async (envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { fonts } = get();
      settings.customFonts = fonts.map(toSettingsFont);
      setSettings(settings);
      saveSettings(envConfig, settings);
    } catch (error) {
      console.error('Failed to save custom fonts settings:', error);
      throw error;
    }
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const store = useCustomFontStore.getState();
    const fonts = store.getAllFonts();
    fonts.forEach((font) => {
      if (font.blobUrl) {
        URL.revokeObjectURL(font.blobUrl);
      }
    });
  });
}
