import { invoke } from '@tauri-apps/api/core';
import { stubTranslation as _ } from '@/utils/misc';
import { getClipOptions } from '@/services/send/clipOptions';
import type { FetchedPage } from './novelImport';

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
    let html: string;
    try {
      html = await invoke<string>('clip_url', {
        url,
        options: {
          ...getClipOptions(translate),
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
  return result;
}
