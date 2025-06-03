import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';

export const interceptWindowOpen = () => {
  const windowOpen = window.open;
  globalThis.open = function (
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (isTauriAppPlatform()) {
      openUrl(url?.toString() || '');
      return null;
    } else {
      return windowOpen(url, target, features);
    }
  };
};
