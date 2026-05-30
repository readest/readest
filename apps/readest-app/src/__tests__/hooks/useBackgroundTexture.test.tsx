import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSettingsStore } from '@/store/settingsStore';
import { CustomTexture } from '@/styles/textures';
import { SystemSettings } from '@/types/settings';
import { ViewSettings } from '@/types/book';
import { EnvConfigType } from '@/services/environment';

vi.mock('@/styles/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/styles/textures')>();
  return {
    ...actual,
    mountBackgroundTexture: vi.fn(),
    unmountBackgroundTexture: vi.fn(),
  };
});

const createMockEnvConfig = (): EnvConfigType =>
  ({
    getAppService: vi.fn().mockResolvedValue({
      openFile: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    }),
  }) as unknown as EnvConfigType;

// Use a saved id that does NOT equal getTextureId(name). This mirrors the
// real-world bug: legacy/synced textures persist an id that wasn't derived
// from the current name. addTexture would re-derive the id from name and
// create a SECOND store entry with the wrong id, leaving the real id
// unfindable. The fix path therefore must seed the store with the saved id.
const SAVED_TEXTURE: CustomTexture = {
  id: 'legacy-saved-id',
  name: 'my-cool-texture',
  path: 'legacy-saved-id/my-cool-texture.png',
};

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    backgroundTextureId: SAVED_TEXTURE.id,
    backgroundOpacity: 0.6,
    backgroundSize: 'cover',
    ...overrides,
  }) as unknown as ViewSettings;

beforeEach(() => {
  useCustomTextureStore.setState({ textures: [], loading: false });
  useSettingsStore.setState({ settings: {} as SystemSettings });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBackgroundTexture', () => {
  test('mounts a custom texture when the store is pre-seeded with its saved id', async () => {
    // Simulates the fixed boot path: Providers seeds the customTextureStore
    // via setTextures(settings.customTextures) before calling the hook. The
    // hook's applyTexture then finds the texture by its saved id.
    const { mountBackgroundTexture } = await import('@/styles/textures');
    vi.mocked(mountBackgroundTexture).mockClear();

    useCustomTextureStore.getState().setTextures([SAVED_TEXTURE]);

    const { result } = renderHook(() => useBackgroundTexture());
    result.current.applyBackgroundTexture(createMockEnvConfig(), makeViewSettings());

    await vi.waitFor(() => {
      expect(mountBackgroundTexture).toHaveBeenCalledTimes(1);
    });

    const mountedTexture = vi.mocked(mountBackgroundTexture).mock.calls[0]?.[1];
    expect(mountedTexture?.id).toBe(SAVED_TEXTURE.id);
  });

  test('does NOT mount the texture when the store is empty (documents the boot bug without the seeding fix)', async () => {
    // Without setTextures seeding, the in-hook addTexture re-derives an id
    // from name and adds a different entry, so applyTexture never finds the
    // saved id and unmounts instead of mounting.
    const { mountBackgroundTexture, unmountBackgroundTexture } = await import('@/styles/textures');
    vi.mocked(mountBackgroundTexture).mockClear();
    vi.mocked(unmountBackgroundTexture).mockClear();

    useSettingsStore.setState({
      settings: { customTextures: [SAVED_TEXTURE] } as unknown as SystemSettings,
    });

    const { result } = renderHook(() => useBackgroundTexture());
    result.current.applyBackgroundTexture(createMockEnvConfig(), makeViewSettings());

    await vi.waitFor(() => {
      expect(unmountBackgroundTexture).toHaveBeenCalled();
    });
    expect(mountBackgroundTexture).not.toHaveBeenCalled();
  });

  test('does nothing when textureId is "none"', () => {
    const { result } = renderHook(() => useBackgroundTexture());
    result.current.applyBackgroundTexture(
      createMockEnvConfig(),
      makeViewSettings({ backgroundTextureId: 'none' }),
    );

    expect(useCustomTextureStore.getState().getTexture(SAVED_TEXTURE.id)).toBeUndefined();
  });
});
