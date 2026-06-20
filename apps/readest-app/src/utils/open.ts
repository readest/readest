import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';

/**
 * Open an external URL in the system browser. On Tauri the in-app webview
 * ignores `target="_blank"`, so route through the opener plugin; on web fall
 * back to `window.open`. Unlike `interceptWindowOpen`, this works without the
 * reader-scoped `window.open` override being installed.
 */
export const openExternalUrl = (url: string) => {
  if (isTauriAppPlatform()) {
    void openUrl(url).catch((err) => console.warn('Failed to open external URL', url, err));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

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
