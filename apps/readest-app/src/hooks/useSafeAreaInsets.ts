import { useCallback, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { Insets } from '@/types/misc';
import { getSafeAreaInsets } from '@/utils/bridge';
import { getOSPlatform } from '@/utils/misc';

export const useSafeAreaInsets = () => {
  const { appService } = useEnv();

  const {
    updateSafeAreaInsets,
    updateScreenCornerRadius,
    setIsIPhoneDuo,
    recordStatusBarHiddenInsets,
  } = useThemeStore();

  const updateInsets = (insets: Insets) => {
    // Compare with the store: this hook runs in both Providers and useTheme,
    // and per-instance memory of the last value goes stale between them.
    const current = useThemeStore.getState().safeAreaInsets;
    if (
      !current ||
      insets.top !== current.top ||
      insets.right !== current.right ||
      insets.bottom !== current.bottom ||
      insets.left !== current.left
    ) {
      updateSafeAreaInsets(insets);
    }
  };

  const onUpdateInsets = useCallback(() => {
    if (!appService) return;

    if (!appService.hasSafeAreaInset) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const hasCustomProperties = rootStyles.getPropertyValue('--safe-area-inset-top');
    if (appService.isIOSApp && getOSPlatform() === 'macos') {
      // for iPadOS use zero insets
      updateInsets({ top: 0, right: 0, bottom: 0, left: 0 });
    } else if (appService.isAndroidApp || appService.isIOSApp) {
      // safe-area-inset-* values in css are always 0px in some versions of webview 139
      // due to https://issues.chromium.org/issues/40699457
      getSafeAreaInsets().then((response) => {
        if (response.error) {
          console.error('Error getting safe area insets from native bridge:', response.error);
        } else {
          const insets = {
            top: Math.round(response.top),
            right: Math.round(response.right),
            bottom: Math.round(response.bottom),
            left: Math.round(response.left),
          };
          // iPhone Duo's status strip carries a side inset of its own: keep the
          // sides seen with the status bar hidden for the reading page.
          if (response.isIPhoneDuo && response.statusBarHidden) recordStatusBarHiddenInsets(insets);
          updateInsets(insets);
          updateScreenCornerRadius(Math.round(response.bottomCornerRadius ?? 0));
          setIsIPhoneDuo(!!response.isIPhoneDuo);
        }
      });
    } else if (hasCustomProperties) {
      const top = parseFloat(rootStyles.getPropertyValue('--safe-area-inset-top')) || 0;
      const right = parseFloat(rootStyles.getPropertyValue('--safe-area-inset-right')) || 0;
      const bottom = parseFloat(rootStyles.getPropertyValue('--safe-area-inset-bottom')) || 0;
      const left = parseFloat(rootStyles.getPropertyValue('--safe-area-inset-left')) || 0;
      const insets = {
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        left: Math.round(left),
      };

      updateInsets(insets);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    onUpdateInsets();

    // Listen for orientation changes
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', onUpdateInsets);
    } else {
      window.addEventListener('orientationchange', onUpdateInsets);
    }

    // Listen for visibility changes (app returning from background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onUpdateInsets();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for window focus (additional safeguard for iOS)
    const handleFocus = () => {
      onUpdateInsets();
    };
    window.addEventListener('focus', handleFocus);

    // A WebView started by CarPlay is already visible to WebKit when its
    // phone scene attaches, so DOM visibility/focus events may not fire.
    const unlistenFocus = appService?.isIOSApp
      ? getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) onUpdateInsets();
        })
      : undefined;

    // Folding or unfolding iPhone Duo and entering Split View move its status
    // strip to another edge without an orientation event (#6307). Only the Duo
    // refetches on resize, so no other device changes.
    const handleResize = () => {
      if (useThemeStore.getState().isIPhoneDuo) onUpdateInsets();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', onUpdateInsets);
      } else {
        window.removeEventListener('orientationchange', onUpdateInsets);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('resize', handleResize);
      void unlistenFocus?.then((unlisten) => unlisten());
    };
  }, [onUpdateInsets]);

  return { onUpdateInsets };
};
