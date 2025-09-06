import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { Insets } from '@/types/misc';
import { getSafeAreaInsets } from '@/utils/bridge';
import { useState, useEffect, useCallback, useRef } from 'react';

export const useSafeAreaInsets = () => {
  const { appService } = useEnv();
  const [updated, setUpdated] = useState(false);
  const [insets, setInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const currentInsets = useRef(insets);

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
      setInsets(insets);
      updateSafeAreaInsets(insets);
    }
  };

  const onUpdateInsets = useCallback(() => {
    if (!appService) return;

    if (!appService.hasSafeAreaInset) {
      updateInsets(insets);
      setUpdated(true);
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
            top: response.top,
            right: response.right,
            bottom: response.bottom,
            left: response.left,
          };
          updateInsets(insets);
        }
        setUpdated(true);
      });
    } else if (hasCustomProperties) {
      const insets = {
        top: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-top')) || 0,
        right: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-right')) || 0,
        bottom: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-bottom')) || 0,
        left: parseFloat(rootStyles.getPropertyValue('--safe-area-inset-left')) || 0,
      };
      updateInsets(insets);
      setUpdated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    onUpdateInsets();
    window.addEventListener('resize', onUpdateInsets);
    return () => {
      window.removeEventListener('resize', onUpdateInsets);
    };
  }, [onUpdateInsets]);

  return updated ? insets : null;
};
