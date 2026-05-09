import { create } from 'zustand';
import { EnvConfigType } from '@/services/environment';
import {
  CustomFont,
  createCustomFont,
  getFontFormat,
  getMimeType,
  mountCustomFont,
} from '@/styles/fonts';
import { useSettingsStore } from './settingsStore';
import { getReplicaPersistEnv } from '@/services/sync/replicaPersist';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import { FONT_KIND } from '@/services/sync/adapters/font';
import { computeFontContentId } from '@/services/fontService';
import { migrateLegacyReplicas } from '@/services/sync/migrateLegacy';

const publishFontUpsert = (font: CustomFont): void => {
  if (!font.contentId) return;
  void publishReplicaUpsert(FONT_KIND, font, font.contentId, font.reincarnation);
};

const publishFontDelete = (contentId: string): void => {
  void publishReplicaDelete(FONT_KIND, contentId);
};

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

  /** Look up a local font by its cross-device contentId. */
  findByContentId: (contentId: string) => CustomFont | undefined;
  /**
   * Add a remote-sourced font from a replica pull WITHOUT republishing.
   * The placeholder lands with `unavailable: true`; the binary download
   * handler clears the flag on completion.
   */
  applyRemoteFont: (font: CustomFont) => void;
  /** Soft-delete by contentId, skipping the publish call. */
  softDeleteByContentId: (contentId: string) => void;
  /** Clear the placeholder unavailable flag once binaries land on disk. */
  markAvailableByContentId: (contentId: string) => void;
  /**
   * Full activation path for a remote-pulled font once its binary has
   * landed on disk: clear the `unavailable` flag, load the file into a
   * blob URL, and inject the `@font-face` rule so the family is
   * actually rendered. Manual imports get this for free in
   * `CustomFonts.tsx`; auto-download needs the same plumbing or the
   * font appears in the UI but renders in a fallback face.
   */
  activateFontByContentId: (envConfig: EnvConfigType, contentId: string) => Promise<void>;

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
      const refreshed = get().getFont(font.id) ?? existingFont;
      publishFontUpsert(refreshed);
      return refreshed;
    }

    const newFont = {
      ...font,
      downloadedAt: Date.now(),
    };

    set((state) => ({
      fonts: [...state.fonts, newFont],
    }));

    publishFontUpsert(newFont);
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
    if (font.contentId) publishFontDelete(font.contentId);
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

  findByContentId: (contentId) =>
    contentId ? get().fonts.find((f) => f.contentId === contentId) : undefined,

  applyRemoteFont: (font) => {
    set((state) => {
      const existingIdx = state.fonts.findIndex((f) => f.id === font.id);
      const fonts =
        existingIdx >= 0
          ? state.fonts.map((f, i) => (i === existingIdx ? { ...font, deletedAt: undefined } : f))
          : [...state.fonts, font];
      return { fonts };
    });
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomFonts(env);
  },

  softDeleteByContentId: (contentId) => {
    const target = get().fonts.find((f) => f.contentId === contentId && !f.deletedAt);
    if (!target) return;
    set((state) => ({
      fonts: state.fonts.map((f) =>
        f.id === target.id ? { ...f, deletedAt: Date.now(), blobUrl: undefined, loaded: false } : f,
      ),
    }));
    if (target.blobUrl) URL.revokeObjectURL(target.blobUrl);
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomFonts(env);
  },

  markAvailableByContentId: (contentId) => {
    set((state) => ({
      fonts: state.fonts.map((f) =>
        f.contentId === contentId ? { ...f, unavailable: undefined } : f,
      ),
    }));
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomFonts(env);
  },

  activateFontByContentId: async (envConfig, contentId) => {
    get().markAvailableByContentId(contentId);
    const target = get().fonts.find((f) => f.contentId === contentId && !f.deletedAt);
    if (!target) return;
    try {
      const loaded = await get().loadFont(envConfig, target.id);
      if (typeof document !== 'undefined') {
        mountCustomFont(document, loaded);
      }
      const env = getReplicaPersistEnv();
      if (env) await get().saveCustomFonts(env);
    } catch (err) {
      console.warn('activateFontByContentId failed', contentId, err);
    }
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
        // Mount @font-face on the main document so settings UI / library
        // chrome can render in the actual face. The Reader mounts again
        // into book documents on top of this; mountCustomFont keys by
        // font id so the second call is an idempotent update.
        if (typeof document !== 'undefined') {
          for (const font of get().getLoadedFonts()) {
            mountCustomFont(document, font);
          }
        }
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

/**
 * Look up a font by its cross-device contentId, falling back to the
 * persisted `settings.customFonts` when the in-memory store is empty.
 * The pull-side orchestrator runs at app boot — earlier than the font
 * panel mount, so loadCustomFonts hasn't hydrated the zustand store
 * yet. Without the fallback every refresh would mint a fresh bundleDir
 * per row and re-download.
 */
export const findFontByContentId = (contentId: string): CustomFont | undefined => {
  if (!contentId) return undefined;
  const inMemory = useCustomFontStore.getState().findByContentId(contentId);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.customFonts ?? [];
  return persisted.find((f) => f.contentId === contentId && !f.deletedAt);
};

/**
 * One-time migration: rehash legacy flat-path fonts (imported before
 * replica sync shipped) into the per-bundle layout so they sync
 * across devices without forcing the user to re-import. Idempotent;
 * skips fonts that already carry `contentId`. Implementation lives in
 * `migrateLegacyReplicas` — shared with custom textures.
 */
export const migrateLegacyFonts = (envConfig: EnvConfigType): Promise<void> =>
  migrateLegacyReplicas<CustomFont>(envConfig, {
    kind: FONT_KIND,
    baseDir: 'Fonts',
    getCandidates: () =>
      useCustomFontStore
        .getState()
        .fonts.filter((f) => !f.contentId && !f.bundleDir && !f.deletedAt && !f.path.includes('/')),
    computeContentId: computeFontContentId,
    updateRecord: (id, next) => useCustomFontStore.getState().updateFont(id, next),
    saveStore: (env) => useCustomFontStore.getState().saveCustomFonts(env),
    publishUpsert: publishFontUpsert,
  });

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
