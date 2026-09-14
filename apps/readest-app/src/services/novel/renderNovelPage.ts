import { invoke } from '@tauri-apps/api/core';
import { stubTranslation as _ } from '@/utils/misc';
import { getClipOptions } from '@/services/send/clipOptions';
import { isBlockedHost } from '@/utils/network';
import type { FetchedPage } from './novelImport';

// This rejects explicit private hosts; DNS and browser redirect resolution remain native.
export function assertNovelUrlAllowed(value: string): void {
  const url = new URL(value);
  const host = url.hostname.replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  // Feed IPv4-compatible literals through the shared IPv4-mapped guard too.
  const compatible = host.match(/^::(?:([a-f0-9]{1,4}):)?([a-f0-9]{1,4})$/i);
  const checkedHost = compatible ? `::ffff:${compatible[1] ?? '0'}:${compatible[2]}` : host;
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    isBlockedHost(checkedHost) ||
    /^(?:ff[0-9a-f]{2}|fe[c-f][0-9a-f]):/i.test(host)
  ) {
    throw new Error('Cannot import from a private or unsupported URL');
  }
}

// Mobile can present only one capture controller at a time. Keep fallback
// rendering serialized while ordinary HTTP chapter requests stay concurrent.
let pending: Promise<unknown> = Promise.resolve();

export function renderNovelPage(
  url: string,
  signal?: AbortSignal,
  translate: (key: string) => string = (key) => key,
): Promise<FetchedPage> {
  const result = pending.then(async () => {
    signal?.throwIfAborted();
    assertNovelUrlAllowed(url);
    let html: string;
    try {
      html = await invoke<string>('clip_url', {
        url,
        options: {
          ...getClipOptions(translate),
          backgroundCapture: true,
          windowTitle: translate(_('Import Web Novel')),
          overlayTitle: translate(_('Import Web Novel')),
          loadingStatus: translate(_('Loading chapter…')),
        },
      });
    } catch (error) {
      if (error === 'Capture cancelled') throw new DOMException('Capture cancelled', 'AbortError');
      throw error;
    }
    signal?.throwIfAborted();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const capturedUrl = doc.documentElement.getAttribute('data-readest-url');
    const finalUrl = capturedUrl && /^https?:\/\//i.test(capturedUrl) ? capturedUrl : url;
    return { html, finalUrl };
  });
  pending = result.catch(() => {});
  if (!signal) return result;
  // Return to the chapter list immediately on cancel. Keep the native render
  // in the queue until it has cleaned up, so a retry cannot overlap it.
  return new Promise<FetchedPage>((resolve, reject) => {
    const abort = () => reject(new DOMException('Capture cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
