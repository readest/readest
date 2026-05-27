/**
 * Offscreen-document host. Runs `convertToEpub({kind:'page'})` (needs DOMParser /
 * Document, which an MV3 service worker lacks) AND the upload to
 * `/api/send/inbox/file`.
 *
 * Why upload from the offscreen page instead of returning the EPUB bytes
 * to the SW: `chrome.runtime.sendMessage` does not reliably structured-
 * clone `ArrayBuffer` between extension contexts in current Chrome —
 * large buffers come through JSON-serialized, which collapses an
 * `ArrayBuffer` to `{}`. Wrapping that in `new Blob([{}])` yields the
 * literal text "[object Object]", and the inbox drainer rightly rejects
 * it as a corrupt EPUB. Uploading from the page that produced the bytes
 * keeps the EPUB in one realm.
 *
 * Protocol:
 *   SW → offscreen: { type:'send-to-readest:clip-and-upload',
 *                     html, url, token }
 *   offscreen → SW: { ok:true, inboxId, title, author, byteSize }
 *               or  { ok:false, code, message }
 */

import { configureZip } from '@/utils/zip';
import { convertToEpub } from '@/services/send/conversion/convertToEpub';
import type { ClipErrorCode } from '../lib/messages';
import { uploadEpub } from '../background/upload';

const LOG = '[send-to-readest/offscreen]';

configureZip().catch((err) => console.warn(LOG, 'configureZip failed', err));

// Cheap liveness probe so the SW can confirm this page is ready to
// accept work, rather than racing `chrome.offscreen.createDocument`'s
// resolution against script execution.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse): boolean => {
  if (!message || typeof message !== 'object') return false;
  const m = message as { type?: string };
  if (m.type !== 'send-to-readest:ping') return false;
  sendResponse({ ok: true });
  return false;
});

interface ClipAndUploadRequest {
  type: 'send-to-readest:clip-and-upload';
  html: string;
  url: string;
  token: string;
  pageTitle: string;
  /** Resolved upload URL — the SW reads `chrome.storage.local.readestApiBase`
   *  and computes this. Passed in so the offscreen page never touches
   *  `chrome.storage` (observed `undefined` in some Chrome builds). */
  endpoint: string;
}

type ClipAndUploadResponse =
  | { ok: true; inboxId: string; title: string; author: string; byteSize: number }
  | { ok: false; code: ClipErrorCode; message: string };

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: ClipAndUploadResponse) => void): boolean => {
    if (!message || typeof message !== 'object') return false;
    const m = message as { type?: string };
    if (m.type !== 'send-to-readest:clip-and-upload') return false;

    const req = message as ClipAndUploadRequest;

    void (async (): Promise<void> => {
      let converted;
      try {
        converted = await convertToEpub({ kind: 'page', html: req.html, url: req.url });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.warn(LOG, 'convert failed', error);
        sendResponse({ ok: false, code: 'no-readable-content', message: error });
        return;
      }

      try {
        const result = await uploadEpub({
          endpoint: req.endpoint,
          token: req.token,
          epub: converted.file,
          title: converted.title || req.pageTitle,
          sourceUrl: req.url,
        });

        if (!result.ok) {
          sendResponse({ ok: false, code: result.code, message: result.message });
          return;
        }
        sendResponse({
          ok: true,
          inboxId: result.id,
          title: converted.title,
          author: converted.author,
          byteSize: converted.file.size,
        });
      } catch (err) {
        // `uploadEpub` is supposed to swallow its own errors — but if a
        // sync throw slips through (e.g. a URL parse on a malformed
        // endpoint), we still must call sendResponse, or the SW hangs
        // forever on the `chrome.runtime.sendMessage` Promise.
        const error = err instanceof Error ? err.message : String(err);
        console.warn(LOG, 'upload threw unexpectedly', error);
        sendResponse({ ok: false, code: 'unknown', message: error });
      }
    })();

    return true;
  },
);
