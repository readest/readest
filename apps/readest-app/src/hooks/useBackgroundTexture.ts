import { useCallback } from 'react';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSettingsStore } from '@/store/settingsStore';
import { EnvConfigType } from '@/services/environment';
import { ViewSettings } from '@/types/book';

export const useBackgroundTexture = () => {
  const applyBackgroundTexture = useCallback(
    (envConfig: EnvConfigType, viewSettings: ViewSettings) => {
      const textureId = viewSettings.backgroundTextureId;
      const textureOpacity = viewSettings.backgroundOpacity;
      const textureSize = viewSettings.backgroundSize;
      if (!textureId || textureId === 'none') return;

      document.documentElement.style.setProperty('--bg-texture-opacity', `${textureOpacity}`);
      document.documentElement.style.setProperty('--bg-texture-size', textureSize);

      const settings = useSettingsStore.getState().settings;
      const customTexture = settings.customTextures?.find((t) => t.id === textureId);

      if (customTexture) {
        // Carry replica-sync metadata (contentId / bundleDir / byteSize)
        // through addTexture so the boot-time "ensure selected texture
        // is in the store" path doesn't drop them and silently un-
        // publish a remote-pulled record.
        useCustomTextureStore.getState().addTexture(customTexture.path, {
          name: customTexture.name,
          contentId: customTexture.contentId,
          bundleDir: customTexture.bundleDir,
          byteSize: customTexture.byteSize,
          animated: customTexture.animated,
        });
      }

      useCustomTextureStore.getState().applyTexture(envConfig, textureId);
    },
    [],
  );

  return { applyBackgroundTexture };
};
