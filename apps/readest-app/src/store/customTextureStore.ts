import { create } from 'zustand';
import { EnvConfigType } from '@/services/environment';
import {
  CustomTexture,
  PREDEFINED_TEXTURES,
  createCustomTexture,
  mountBackgroundTexture,
  unmountBackgroundTexture,
} from '@/styles/textures';
import { useSettingsStore } from './settingsStore';

interface TextureStoreState {
  textures: CustomTexture[];
  loading: boolean;

  setTextures: (textures: CustomTexture[]) => void;
  addTexture: (path: string) => CustomTexture;
  removeTexture: (id: string) => boolean;
  updateTexture: (id: string, updates: Partial<CustomTexture>) => boolean;
  getTexture: (id: string) => CustomTexture | undefined;
  getAllTextures: () => CustomTexture[];
  getAvailableTextures: () => CustomTexture[];
  clearAllTextures: () => void;

  applyTexture: (envConfig: EnvConfigType, textureId: string) => Promise<void>;
  loadTexture: (envConfig: EnvConfigType, textureId: string) => Promise<CustomTexture>;
  loadTextures: (envConfig: EnvConfigType, textureIds: string[]) => Promise<CustomTexture[]>;
  loadAllTextures: (envConfig: EnvConfigType) => Promise<CustomTexture[]>;
  unloadTexture: (textureId: string) => boolean;
  unloadAllTextures: () => void;

  getLoadedTextures: () => CustomTexture[];
  isTextureLoaded: (textureId: string) => boolean;

  loadCustomTextures: (envConfig: EnvConfigType) => Promise<void>;
  saveCustomTextures: (envConfig: EnvConfigType) => Promise<void>;
}

function toSettingsTexture(texture: CustomTexture): CustomTexture {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { blobUrl, loaded, error, ...settingsTexture } = texture;
  return settingsTexture;
}

export const useCustomTextureStore = create<TextureStoreState>((set, get) => ({
  textures: [],
  loading: false,

  setTextures: (textures) => set({ textures }),

  addTexture: (path) => {
    const texture = createCustomTexture(path);
    const existingTexture = get().textures.find((t) => t.id === texture.id);

    if (existingTexture) {
      get().updateTexture(texture.id, {
        ...texture,
        path: texture.path,
        downloadedAt: Date.now(),
        deletedAt: undefined,
        loaded: false,
        blobUrl: undefined,
        error: undefined,
      });
      set((state) => ({
        textures: [...state.textures],
      }));
      return existingTexture;
    }

    const newTexture = {
      ...texture,
      downloadedAt: Date.now(),
    };

    set((state) => ({
      textures: [...state.textures, newTexture],
    }));

    return newTexture;
  },

  removeTexture: (id) => {
    const texture = get().getTexture(id);
    if (!texture) return false;

    if (texture.blobUrl) {
      URL.revokeObjectURL(texture.blobUrl);
    }

    const result = get().updateTexture(id, {
      deletedAt: Date.now(),
      blobUrl: undefined,
      loaded: false,
      error: undefined,
    });
    set((state) => ({
      textures: [...state.textures],
    }));
    return result;
  },

  updateTexture: (id, updates) => {
    const state = get();
    const textureIndex = state.textures.findIndex((texture) => texture.id === id);

    if (textureIndex === -1) return false;

    set((state) => ({
      textures: state.textures.map((texture, index) =>
        index === textureIndex ? { ...texture, ...updates } : texture,
      ),
    }));

    return true;
  },

  getTexture: (id) => {
    return get().textures.find((texture) => texture.id === id);
  },

  getAllTextures: () => {
    return get().textures;
  },

  getAvailableTextures: () => {
    return get().textures.filter((texture) => !texture.deletedAt);
  },

  clearAllTextures: () => {
    const { textures } = get();
    textures.forEach((texture) => {
      if (texture.blobUrl) {
        URL.revokeObjectURL(texture.blobUrl);
      }
    });

    set({ textures: [] });
  },

  loadTexture: async (envConfig, textureId) => {
    const texture = get().getTexture(textureId);

    if (!texture) {
      throw new Error(`Texture with id "${textureId}" not found`);
    }

    if (texture.deletedAt) {
      throw new Error(`Texture "${texture.name}" has been deleted`);
    }

    if (texture.loaded && texture.blobUrl && !texture.error) {
      return texture;
    }

    try {
      get().updateTexture(textureId, {
        loaded: false,
        error: undefined,
      });

      const appService = await envConfig.getAppService();
      const textureFile = await appService.openFile(texture.path, 'Images');

      const ext = texture.path.split('.').pop()?.toLowerCase();
      const mimeTypes: { [key: string]: string } = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
      };
      const mimeType = mimeTypes[ext || ''] || 'image/jpeg';

      const blob = new Blob([await textureFile.arrayBuffer()], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      get().updateTexture(textureId, {
        blobUrl,
        loaded: true,
        error: undefined,
      });

      const updatedTexture = get().getTexture(textureId)!;
      return updatedTexture;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      get().updateTexture(textureId, {
        loaded: false,
        error: errorMessage,
        blobUrl: undefined,
      });

      throw error;
    }
  },

  loadTextures: async (envConfig, textureIds) => {
    set({ loading: true });
    try {
      const results = await Promise.allSettled(
        textureIds.map((id) => get().loadTexture(envConfig, id)),
      );

      return results
        .filter(
          (result): result is PromiseFulfilledResult<CustomTexture> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value);
    } finally {
      set({ loading: false });
    }
  },

  loadAllTextures: async (envConfig) => {
    const textureIds = get()
      .getAvailableTextures()
      .map((texture) => texture.id);
    return await get().loadTextures(envConfig, textureIds);
  },

  unloadTexture: (textureId) => {
    const texture = get().getTexture(textureId);

    if (texture?.blobUrl) {
      URL.revokeObjectURL(texture.blobUrl);
    }

    return get().updateTexture(textureId, {
      blobUrl: undefined,
      loaded: false,
      error: undefined,
    });
  },

  unloadAllTextures: () => {
    const textures = get().getAllTextures();

    textures.forEach((texture) => {
      if (texture.blobUrl) {
        URL.revokeObjectURL(texture.blobUrl);
      }
    });

    textures.forEach((texture) => {
      get().updateTexture(texture.id, {
        blobUrl: undefined,
        loaded: false,
        error: undefined,
      });
    });
  },

  getLoadedTextures: () => {
    return get()
      .getAvailableTextures()
      .filter((texture) => texture.loaded && !texture.error);
  },

  isTextureLoaded: (textureId) => {
    const texture = get().getTexture(textureId);
    return texture?.loaded === true && !texture.error && !texture.deletedAt;
  },

  applyTexture: async (envConfig, textureId) => {
    const customTextures = get().getAvailableTextures();
    const allTextures = [...PREDEFINED_TEXTURES, ...customTextures];
    let selectedTexture = allTextures.find((t) => t.id === textureId);

    if (!selectedTexture || selectedTexture.id === 'none') {
      unmountBackgroundTexture(document);
      return;
    }

    if (customTextures.find((t) => t.id === textureId) && !get().isTextureLoaded(textureId)) {
      selectedTexture = await get().loadTexture(envConfig, textureId);
    }

    mountBackgroundTexture(document, selectedTexture);
  },

  loadCustomTextures: async (envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const currentTextures = get().textures;

      if (settings?.customTextures) {
        const textures = settings.customTextures.map((texture) => {
          const existingTexture = currentTextures.find((t) => t.id === texture.id);
          return {
            ...texture,
            loaded: existingTexture?.loaded || false,
            error: existingTexture?.error,
            blobUrl: existingTexture?.blobUrl,
          };
        });
        set({ textures });
        await get().loadAllTextures(envConfig);
      }
    } catch (error) {
      console.error('Failed to load custom textures settings:', error);
    }
  },

  saveCustomTextures: async (envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { textures } = get();

      settings.customTextures = textures.map(toSettingsTexture);

      setSettings(settings);
      saveSettings(envConfig, settings);
    } catch (error) {
      console.error('Failed to save custom textures settings:', error);
      throw error;
    }
  },
}));

// Cleanup blob URLs before page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const store = useCustomTextureStore.getState();
    const textures = store.getAllTextures();
    textures.forEach((texture) => {
      if (texture.blobUrl) {
        URL.revokeObjectURL(texture.blobUrl);
      }
    });
  });
}
