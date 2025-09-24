import { useCallback, useRef, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { Insets } from '@/types/misc';
import { getSafeAreaInsets } from '@/utils/bridge';

export const useSafeAreaInsets = () => {
  const { appService } = useEnv();
  const currentInsets = useRef({ top: 0, right: 0, bottom: 0, left: 0 });

  const { updateSafeAreaInsets } = useThemeStore();

  const updateInsets = (insets: Insets) => {
    const { top, right, bottom, left } = currentInsets.current;
    if (
      insets.top !== top ||
      insets.right !== right ||
      insets.bottom !== bottom ||
      insets.left !== left
    ) {
      currentInsets.current = insets;
      updateSafeAreaInsets(insets);
    }
  };

  const onUpdateInsets = useCallback(() => {
    if (!appService) return;

    if (!appService.hasSafeAreaInset) {
      updateInsets(currentInsets.current);
      return;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const hasCustomProperties = rootStyles.getPropertyValue('--safe-area-inset-top');
    const isWebView139 = /Chrome\/139/.test(navigator.userAgent);
    // safe-area-inset-* values in css are always 0px in some versions of webview 139
    // due to https://issues.chromium.org/issues/40699457
    if (appService.isAndroidApp && isWebView139) {
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
          updateInsets(insets);
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
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', onUpdateInsets);
    } else {
      window.addEventListener('orientationchange', onUpdateInsets);
    }
    return () => {
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', onUpdateInsets);
      } else {
        window.removeEventListener('orientationchange', onUpdateInsets);
      }
    };
  }, [onUpdateInsets]);
};
