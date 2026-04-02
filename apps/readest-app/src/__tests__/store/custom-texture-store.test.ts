import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSettingsStore } from '@/store/settingsStore';
import { CustomTexture } from '@/styles/textures';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';

// Mock textures module - we need createCustomTexture, and the mount/unmount functions
vi.mock('@/styles/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/styles/textures')>();
  return {
    ...actual,
    mountBackgroundTexture: vi.fn(),
    unmountBackgroundTexture: vi.fn(),
  };
});

function makeTexture(
  overrides: Partial<CustomTexture> & { id: string; name: string },
): CustomTexture {
  return {
    path: `/textures/${overrides.name}.png`,
    ...overrides,
  };
}

function createMockEnvConfig(): EnvConfigType {
  return {
    getAppService: vi.fn(),
  } as unknown as EnvConfigType;
}

beforeEach(() => {
  useCustomTextureStore.setState({
    textures: [],
    loading: false,
  });
  useSettingsStore.setState({
    settings: {} as SystemSettings,
  });
});

describe('customTextureStore', () => {
  // ── setTextures ────────────────────────────────────────────────
  describe('setTextures', () => {
    test('sets textures array', () => {
      const textures: CustomTexture[] = [
        makeTexture({ id: 'tex1', name: 'Marble', path: '/textures/marble.png' }),
      ];
      useCustomTextureStore.getState().setTextures(textures);
      expect(useCustomTextureStore.getState().textures).toEqual(textures);
    });

    test('overwrites existing textures', () => {
      useCustomTextureStore
        .getState()
        .setTextures([makeTexture({ id: 'a', name: 'A', path: '/a.png' })]);
      const newTextures = [makeTexture({ id: 'b', name: 'B', path: '/b.png' })];
      useCustomTextureStore.getState().setTextures(newTextures);
      expect(useCustomTextureStore.getState().textures).toHaveLength(1);
      expect(useCustomTextureStore.getState().textures[0]!.id).toBe('b');
    });
  });

  // ── addTexture ─────────────────────────────────────────────────
  describe('addTexture', () => {
    test('adds a new texture from a path', () => {
      const texture = useCustomTextureStore.getState().addTexture('/images/wood.png');
      expect(texture).toBeDefined();
      expect(texture.name).toBe('wood');
      expect(texture.path).toBe('/images/wood.png');
      expect(useCustomTextureStore.getState().textures).toHaveLength(1);
    });

    test('sets downloadedAt on new texture', () => {
      const before = Date.now();
      useCustomTextureStore.getState().addTexture('/images/stone.jpg');
      const tex = useCustomTextureStore.getState().textures[0]!;
      expect(tex.downloadedAt).toBeGreaterThanOrEqual(before);
    });

    test('returns existing texture when adding duplicate path', () => {
      const first = useCustomTextureStore.getState().addTexture('/images/wood.png');
      const second = useCustomTextureStore.getState().addTexture('/images/wood.png');
      // Should return the existing texture object
      expect(second.id).toBe(first.id);
      // Store should still have only one texture
      expect(useCustomTextureStore.getState().textures).toHaveLength(1);
    });

    test('re-adding same path clears deletedAt on existing texture', () => {
      useCustomTextureStore.getState().addTexture('/images/wood.png');
      useCustomTextureStore
        .getState()
        .removeTexture(useCustomTextureStore.getState().textures[0]!.id);
      const tex = useCustomTextureStore.getState().textures[0]!;
      expect(tex.deletedAt).toBeDefined();

      useCustomTextureStore.getState().addTexture('/images/wood.png');
      const updated = useCustomTextureStore.getState().textures[0]!;
      expect(updated.deletedAt).toBeUndefined();
    });
  });

  // ── removeTexture ──────────────────────────────────────────────
  describe('removeTexture', () => {
    test('marks a texture as deleted', () => {
      const tex = useCustomTextureStore.getState().addTexture('/images/water.png');
      const result = useCustomTextureStore.getState().removeTexture(tex.id);
      expect(result).toBe(true);
      const removed = useCustomTextureStore.getState().getTexture(tex.id);
      expect(removed?.deletedAt).toBeDefined();
    });

    test('returns false for non-existent id', () => {
      const result = useCustomTextureStore.getState().removeTexture('nonexistent');
      expect(result).toBe(false);
    });

    test('clears blobUrl and loaded state', () => {
      const tex = useCustomTextureStore.getState().addTexture('/images/water.png');
      useCustomTextureStore.getState().updateTexture(tex.id, {
        blobUrl: 'blob:test',
        loaded: true,
      });
      useCustomTextureStore.getState().removeTexture(tex.id);
      const removed = useCustomTextureStore.getState().getTexture(tex.id);
      expect(removed?.blobUrl).toBeUndefined();
      expect(removed?.loaded).toBe(false);
    });
  });

  // ── updateTexture ──────────────────────────────────────────────
  describe('updateTexture', () => {
    test('updates fields on an existing texture', () => {
      const tex = useCustomTextureStore.getState().addTexture('/images/sky.png');
      const result = useCustomTextureStore.getState().updateTexture(tex.id, {
        loaded: true,
        blobUrl: 'blob:abc',
      });
      expect(result).toBe(true);
      const updated = useCustomTextureStore.getState().getTexture(tex.id);
      expect(updated?.loaded).toBe(true);
      expect(updated?.blobUrl).toBe('blob:abc');
    });

    test('returns false for non-existent id', () => {
      const result = useCustomTextureStore.getState().updateTexture('missing', { loaded: true });
      expect(result).toBe(false);
    });
  });

  // ── getTexture ─────────────────────────────────────────────────
  describe('getTexture', () => {
    test('returns the texture by id', () => {
      const tex = useCustomTextureStore.getState().addTexture('/images/grass.png');
      const found = useCustomTextureStore.getState().getTexture(tex.id);
      expect(found?.name).toBe('grass');
    });

    test('returns undefined for unknown id', () => {
      expect(useCustomTextureStore.getState().getTexture('nope')).toBeUndefined();
    });
  });

  // ── getAllTextures ─────────────────────────────────────────────
  describe('getAllTextures', () => {
    test('returns all textures including deleted', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().addTexture('/b.png');
      useCustomTextureStore.getState().removeTexture(t1.id);
      expect(useCustomTextureStore.getState().getAllTextures()).toHaveLength(2);
    });
  });

  // ── getAvailableTextures ───────────────────────────────────────
  describe('getAvailableTextures', () => {
    test('excludes deleted textures', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().addTexture('/b.png');
      useCustomTextureStore.getState().removeTexture(t1.id);
      const available = useCustomTextureStore.getState().getAvailableTextures();
      expect(available).toHaveLength(1);
      expect(available[0]!.name).toBe('b');
    });

    test('returns empty array when all are deleted', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().removeTexture(t1.id);
      expect(useCustomTextureStore.getState().getAvailableTextures()).toHaveLength(0);
    });
  });

  // ── clearAllTextures ───────────────────────────────────────────
  describe('clearAllTextures', () => {
    test('removes all textures', () => {
      useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().addTexture('/b.png');
      useCustomTextureStore.getState().clearAllTextures();
      expect(useCustomTextureStore.getState().textures).toHaveLength(0);
    });
  });

  // ── unloadTexture ──────────────────────────────────────────────
  describe('unloadTexture', () => {
    test('clears loaded state and blobUrl', () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(tex.id, {
        loaded: true,
        blobUrl: 'blob:test',
      });
      const result = useCustomTextureStore.getState().unloadTexture(tex.id);
      expect(result).toBe(true);
      const t = useCustomTextureStore.getState().getTexture(tex.id);
      expect(t?.loaded).toBe(false);
      expect(t?.blobUrl).toBeUndefined();
    });

    test('returns false for non-existent texture', () => {
      const result = useCustomTextureStore.getState().unloadTexture('nope');
      expect(result).toBe(false);
    });
  });

  // ── unloadAllTextures ──────────────────────────────────────────
  describe('unloadAllTextures', () => {
    test('unloads all textures', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      const t2 = useCustomTextureStore.getState().addTexture('/b.png');
      useCustomTextureStore.getState().updateTexture(t1.id, { loaded: true, blobUrl: 'blob:1' });
      useCustomTextureStore.getState().updateTexture(t2.id, { loaded: true, blobUrl: 'blob:2' });

      useCustomTextureStore.getState().unloadAllTextures();

      const all = useCustomTextureStore.getState().getAllTextures();
      for (const t of all) {
        expect(t.loaded).toBe(false);
        expect(t.blobUrl).toBeUndefined();
      }
    });
  });

  // ── getLoadedTextures / isTextureLoaded ────────────────────────
  describe('getLoadedTextures', () => {
    test('returns only loaded non-deleted textures', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      const t2 = useCustomTextureStore.getState().addTexture('/b.png');
      useCustomTextureStore.getState().updateTexture(t1.id, { loaded: true });
      useCustomTextureStore.getState().updateTexture(t2.id, { loaded: false });
      const loaded = useCustomTextureStore.getState().getLoadedTextures();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe(t1.id);
    });

    test('excludes textures with errors', () => {
      const t1 = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(t1.id, {
        loaded: true,
        error: 'load failed',
      });
      expect(useCustomTextureStore.getState().getLoadedTextures()).toHaveLength(0);
    });
  });

  describe('isTextureLoaded', () => {
    test('returns true for loaded texture without error', () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(tex.id, { loaded: true });
      expect(useCustomTextureStore.getState().isTextureLoaded(tex.id)).toBe(true);
    });

    test('returns false for deleted texture', () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(tex.id, { loaded: true });
      useCustomTextureStore.getState().removeTexture(tex.id);
      expect(useCustomTextureStore.getState().isTextureLoaded(tex.id)).toBe(false);
    });

    test('returns false for texture with error', () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(tex.id, {
        loaded: true,
        error: 'err',
      });
      expect(useCustomTextureStore.getState().isTextureLoaded(tex.id)).toBe(false);
    });

    test('returns false for unknown texture', () => {
      expect(useCustomTextureStore.getState().isTextureLoaded('nope')).toBe(false);
    });
  });

  // ── loadTexture ────────────────────────────────────────────────
  describe('loadTexture', () => {
    test('throws for non-existent texture', async () => {
      const envConfig = createMockEnvConfig();
      await expect(
        useCustomTextureStore.getState().loadTexture(envConfig, 'nonexistent'),
      ).rejects.toThrow('not found');
    });

    test('throws for deleted texture', async () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().removeTexture(tex.id);
      const envConfig = createMockEnvConfig();
      await expect(useCustomTextureStore.getState().loadTexture(envConfig, tex.id)).rejects.toThrow(
        'deleted',
      );
    });

    test('returns immediately if already loaded', async () => {
      const tex = useCustomTextureStore.getState().addTexture('/a.png');
      useCustomTextureStore.getState().updateTexture(tex.id, {
        loaded: true,
        blobUrl: 'blob:existing',
      });
      const envConfig = createMockEnvConfig();
      const result = await useCustomTextureStore.getState().loadTexture(envConfig, tex.id);
      expect(result.blobUrl).toBe('blob:existing');
      // getAppService should not be called
      expect(envConfig.getAppService).not.toHaveBeenCalled();
    });
  });

  // ── saveCustomTextures ─────────────────────────────────────────
  describe('saveCustomTextures', () => {
    test('saves textures to settings store (without blobUrl/loaded/error)', async () => {
      useCustomTextureStore.getState().addTexture('/images/marble.png');
      const tex = useCustomTextureStore.getState().textures[0]!;
      useCustomTextureStore.getState().updateTexture(tex.id, {
        loaded: true,
        blobUrl: 'blob:test',
        error: undefined,
      });

      const mockSetSettings = vi.fn();
      const mockSaveSettings = vi.fn();
      useSettingsStore.setState({
        settings: {} as SystemSettings,
        setSettings: mockSetSettings,
        saveSettings: mockSaveSettings,
      });

      const envConfig = createMockEnvConfig();
      await useCustomTextureStore.getState().saveCustomTextures(envConfig);

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);

      // The settings object passed should have customTextures without blobUrl/loaded/error
      const savedSettings = mockSetSettings.mock.calls[0]![0] as SystemSettings;
      const savedTextures = savedSettings.customTextures;
      expect(savedTextures).toBeDefined();
      expect(savedTextures).toHaveLength(1);
      expect(savedTextures![0]).not.toHaveProperty('blobUrl');
      expect(savedTextures![0]).not.toHaveProperty('loaded');
      expect(savedTextures![0]).not.toHaveProperty('error');
    });
  });

  // ── applyTexture ───────────────────────────────────────────────
  describe('applyTexture', () => {
    test('calls unmountBackgroundTexture for "none" id', async () => {
      const { unmountBackgroundTexture } = await import('@/styles/textures');
      const envConfig = createMockEnvConfig();
      await useCustomTextureStore.getState().applyTexture(envConfig, 'none');
      expect(unmountBackgroundTexture).toHaveBeenCalled();
    });

    test('calls unmountBackgroundTexture for unknown texture id', async () => {
      const { unmountBackgroundTexture } = await import('@/styles/textures');
      const envConfig = createMockEnvConfig();
      await useCustomTextureStore.getState().applyTexture(envConfig, 'unknown-id');
      expect(unmountBackgroundTexture).toHaveBeenCalled();
    });

    test('calls mountBackgroundTexture for predefined texture', async () => {
      const { mountBackgroundTexture } = await import('@/styles/textures');
      const envConfig = createMockEnvConfig();
      await useCustomTextureStore.getState().applyTexture(envConfig, 'concrete');
      expect(mountBackgroundTexture).toHaveBeenCalled();
    });
  });
});
