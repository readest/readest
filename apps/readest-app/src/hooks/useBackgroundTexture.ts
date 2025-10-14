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
        useCustomTextureStore.getState().addTexture(customTexture.path);
      }

      useCustomTextureStore.getState().applyTexture(envConfig, textureId);
    },
    [],
  );

  return { applyBackgroundTexture };
};
