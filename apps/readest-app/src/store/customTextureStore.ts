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
import { getReplicaPersistEnv } from '@/services/sync/replicaPersist';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import { TEXTURE_KIND } from '@/services/sync/adapters/texture';
import { computeTextureContentId } from '@/services/imageService';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import { partialMD5 } from '@/utils/md5';
import { uniqueId } from '@/utils/misc';

const publishTextureUpsert = (texture: CustomTexture): void => {
  if (!texture.contentId) return;
  void publishReplicaUpsert(TEXTURE_KIND, texture, texture.contentId, texture.reincarnation);
};

const publishTextureDelete = (contentId: string): void => {
  void publishReplicaDelete(TEXTURE_KIND, contentId);
};

interface TextureStoreState {
  textures: CustomTexture[];
  loading: boolean;

  setTextures: (textures: CustomTexture[]) => void;
  addTexture: (
    path: string,
    options?: Partial<Omit<CustomTexture, 'id' | 'path'>>,
  ) => CustomTexture;
  removeTexture: (id: string) => boolean;
  updateTexture: (id: string, updates: Partial<CustomTexture>) => boolean;
  getTexture: (id: string) => CustomTexture | undefined;
  getAllTextures: () => CustomTexture[];
  getAvailableTextures: () => CustomTexture[];
  clearAllTextures: () => void;

  /** Look up a local texture by its cross-device contentId. */
  findByContentId: (contentId: string) => CustomTexture | undefined;
  /**
   * Add a remote-sourced texture from a replica pull WITHOUT republishing.
   * The placeholder lands with `unavailable: true`; the binary download
   * handler clears the flag on completion.
   */
  applyRemoteTexture: (texture: CustomTexture) => void;
  /** Soft-delete by contentId, skipping the publish call. */
  softDeleteByContentId: (contentId: string) => void;
  /** Clear the placeholder unavailable flag once binaries land on disk. */
  markAvailableByContentId: (contentId: string) => void;
  /**
   * Activation path for a remote-pulled texture once its binary has
   * landed on disk: clear the `unavailable` flag and load the file
   * into a blob URL so the panel can render the swatch and so
   * `applyTexture` can mount it without re-reading disk. Mirrors the
   * font activation, minus the @font-face injection (textures only
   * mount when selected via `applyTexture`).
   */
  activateTextureByContentId: (envConfig: EnvConfigType, contentId: string) => Promise<void>;

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

  addTexture: (path, options) => {
    const texture = createCustomTexture(path, options);
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
      const refreshed = get().getTexture(texture.id) ?? existingTexture;
      publishTextureUpsert(refreshed);
      return refreshed;
    }

    const newTexture = {
      ...texture,
      downloadedAt: Date.now(),
    };

    set((state) => ({
      textures: [...state.textures, newTexture],
    }));

    publishTextureUpsert(newTexture);
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
    if (texture.contentId) publishTextureDelete(texture.contentId);
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

  findByContentId: (contentId) =>
    contentId ? get().textures.find((t) => t.contentId === contentId) : undefined,

  applyRemoteTexture: (texture) => {
    set((state) => {
      const existingIdx = state.textures.findIndex((t) => t.id === texture.id);
      const textures =
        existingIdx >= 0
          ? state.textures.map((t, i) =>
              i === existingIdx ? { ...texture, deletedAt: undefined } : t,
            )
          : [...state.textures, texture];
      return { textures };
    });
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomTextures(env);
  },

  softDeleteByContentId: (contentId) => {
    const target = get().textures.find((t) => t.contentId === contentId && !t.deletedAt);
    if (!target) return;
    set((state) => ({
      textures: state.textures.map((t) =>
        t.id === target.id ? { ...t, deletedAt: Date.now(), blobUrl: undefined, loaded: false } : t,
      ),
    }));
    if (target.blobUrl) URL.revokeObjectURL(target.blobUrl);
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomTextures(env);
  },

  markAvailableByContentId: (contentId) => {
    set((state) => ({
      textures: state.textures.map((t) =>
        t.contentId === contentId ? { ...t, unavailable: undefined } : t,
      ),
    }));
    const env = getReplicaPersistEnv();
    if (env) void get().saveCustomTextures(env);
  },

  activateTextureByContentId: async (envConfig, contentId) => {
    get().markAvailableByContentId(contentId);
    const target = get().textures.find((t) => t.contentId === contentId && !t.deletedAt);
    if (!target) return;
    try {
      await get().loadTexture(envConfig, target.id);
      const env = getReplicaPersistEnv();
      if (env) await get().saveCustomTextures(env);
    } catch (err) {
      console.warn('activateTextureByContentId failed', contentId, err);
    }
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

/**
 * Look up a texture by its cross-device contentId, falling back to the
 * persisted `settings.customTextures` when the in-memory store is empty.
 * The pull-side orchestrator runs at app boot — earlier than the color
 * panel mount, so loadCustomTextures hasn't hydrated the zustand store
 * yet. Without the fallback every refresh would mint a fresh bundleDir
 * per row and re-download.
 */
export const findTextureByContentId = (contentId: string): CustomTexture | undefined => {
  if (!contentId) return undefined;
  const inMemory = useCustomTextureStore.getState().findByContentId(contentId);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.customTextures ?? [];
  return persisted.find((t) => t.contentId === contentId && !t.deletedAt);
};

/**
 * One-time migration: rehash legacy flat-path textures (imported before
 * replica sync shipped) into the per-bundle layout so they sync
 * across devices without forcing the user to re-import.
 *
 * For each live texture with no `contentId`:
 *   1. Read bytes from `Images/<filename>`.
 *   2. Compute partialMD5 + size → contentId.
 *   3. Mint `bundleDir = uniqueId()`; copy the file to
 *      `Images/<bundleDir>/<filename>` and remove the flat-path one.
 *   4. Patch the in-memory record (contentId, bundleDir, byteSize,
 *      path), persist via saveCustomTextures, then publish through
 *      publishReplicaUpsert.
 *
 * Idempotent: a texture that already carries `contentId` is skipped.
 * If the file is missing on disk, the migration leaves the record
 * untouched. Per-texture failures are logged and don't block the rest.
 */
export const migrateLegacyTextures = async (envConfig: EnvConfigType): Promise<void> => {
  const candidates = useCustomTextureStore
    .getState()
    .textures.filter((t) => !t.contentId && !t.bundleDir && !t.deletedAt && !t.path.includes('/'));
  if (candidates.length === 0) return;

  const appService = await envConfig.getAppService();
  const migrated: CustomTexture[] = [];

  for (const legacy of candidates) {
    try {
      const exists = await appService.exists(legacy.path, 'Images');
      if (!exists) continue;

      const file = await appService.openFile(legacy.path, 'Images');
      const bytes = await file.arrayBuffer();
      const partialMd5 = await partialMD5(file);
      const byteSize = bytes.byteLength;
      const filename = legacy.path;
      const contentId = computeTextureContentId(partialMd5, byteSize, filename);
      const bundleDir = uniqueId();
      const newPath = `${bundleDir}/${filename}`;

      await appService.createDir(bundleDir, 'Images', true);
      await appService.copyFile(legacy.path, 'Images', newPath, 'Images');
      await appService.deleteFile(legacy.path, 'Images');

      const next: CustomTexture = {
        ...legacy,
        contentId,
        bundleDir,
        byteSize,
        path: newPath,
        // Force a re-load on next render so the blob URL points at the
        // new on-disk path.
        blobUrl: undefined,
        loaded: false,
        error: undefined,
      };
      useCustomTextureStore.getState().updateTexture(legacy.id, next);
      migrated.push(next);
    } catch (err) {
      console.warn('migrateLegacyTextures: failed for', legacy.path, err);
    }
  }

  if (migrated.length === 0) return;

  try {
    await useCustomTextureStore.getState().saveCustomTextures(envConfig);
  } catch (err) {
    console.warn('migrateLegacyTextures: save failed', err);
  }
  for (const texture of migrated) {
    publishTextureUpsert(texture);
    void queueReplicaBinaryUpload('texture', texture, appService);
  }
};

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
