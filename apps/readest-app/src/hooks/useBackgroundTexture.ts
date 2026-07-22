import { useCallback } from 'react';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSettingsStore } from '@/store/settingsStore';
import { EnvConfigType } from '@/services/environment';
import { ViewSettings } from '@/types/book';

export const useBackgroundTexture = () => {
  const applyBackgroundTexture = useCallback(
    (envConfig: EnvConfigType, viewSettings: ViewSettings) => {
      const textureId = viewSettings.backgroundTextureId || 'none';

      if (textureId !== 'none') {
        document.documentElement.style.setProperty(
          '--bg-texture-opacity',
          `${viewSettings.backgroundOpacity}`,
        );
        document.documentElement.style.setProperty(
          '--bg-texture-size',
          viewSettings.backgroundSize,
        );

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
      }

      // Always delegate to applyTexture: for a real texture it mounts/loads,
      // for 'none' it unmounts. The library and reader share one
      // #background-texture style element, so switching to a 'none' page must
      // actively clear a texture the other page mounted (issue #4743).
      useCustomTextureStore.getState().applyTexture(envConfig, textureId);
    },
    [],
  );

  return { applyBackgroundTexture };
};
