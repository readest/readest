/**
 * In-app web browser as a book source (#5775).
 *
 * `openWebBrowser` resolves when the user closes the browser. Files the
 * user downloads inside it arrive as `web-browser-download` events on
 * every platform (a Tauri window event on desktop, a native-bridge plugin
 * event on mobile); `useWebBrowserDownloads` imports them and reports the
 * outcome back to the browser chrome through `setWebBrowserStatus`.
 */

import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import type { WebBrowserOptions } from './webBrowserOptions';

export const WEB_BROWSER_DOWNLOAD_EVENT = 'web-browser-download';

export interface WebBrowserDownload {
  url: string;
  path: string;
  filename: string;
  success: boolean;
  error?: string;
}

export interface WebBrowserStatus {
  state: 'importing' | 'added' | 'failed' | 'unsupported';
  filename: string;
  /** The chrome's [Open] button hands this back through `openWebBrowser`. */
  bookHash?: string;
}

export interface WebBrowserResult {
  openBookHash?: string;
}

export async function openWebBrowser(
  url: string,
  options: WebBrowserOptions,
): Promise<WebBrowserResult> {
  const result = await invoke<WebBrowserResult | null>('open_web_browser', { url, options });
  return result ?? {};
}

export async function setWebBrowserStatus(status: WebBrowserStatus): Promise<void> {
  try {
    await invoke('set_web_browser_status', { status });
  } catch (err) {
    // The browser may already be closed; the library toast still reports the outcome.
    console.warn('[browser] set_web_browser_status failed', err);
  }
}

export async function subscribeWebBrowserDownloads(
  isMobile: boolean,
  onDownload: (download: WebBrowserDownload) => void,
): Promise<() => void> {
  if (isMobile) {
    const listener = await addPluginListener<WebBrowserDownload>(
      'native-bridge',
      WEB_BROWSER_DOWNLOAD_EVENT,
      onDownload,
    );
    return () => {
      void listener.unregister();
    };
  }
  const unlisten = await getCurrentWindow().listen<WebBrowserDownload>(
    WEB_BROWSER_DOWNLOAD_EVENT,
    ({ payload }) => onDownload(payload),
  );
  return unlisten;
}

export function isSupportedBookDownload(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return SUPPORTED_BOOK_EXTS.includes(filename.slice(dot + 1).toLowerCase());
}
