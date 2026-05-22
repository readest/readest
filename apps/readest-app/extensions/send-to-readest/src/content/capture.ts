/**
 * Content-script entry point for capturing the current page. Injected
 * on-demand by the service worker via `chrome.scripting.executeScript({
 * files: ['content/capture.js'] })`.
 *
 * Reduced to a thin shell: grab the rendered `outerHTML` and hand it to
 * the SW on a long-lived Port. The SW runs everything else (Readability
 * extraction, asset bundling, cover generation, TOC, EPUB build) through
 * the shared `convertPageToEpub` in `src/services/send/conversion/`, so
 * an extension-clipped EPUB is byte-identical to a desktop / mobile-
 * clipped EPUB for the same URL.
 *
 * We intentionally do NOT scroll the page to materialise lazy-loaded
 * images — the user can see the scroll, and on long pages it's visible
 * and slow. Images that haven't been viewed are typically still
 * resolvable via `data-src` / `srcset` attributes which `bundleAssets`
 * already understands, so the cost is small.
 */

import type { PageSnapshot } from '../lib/messages';

const LOG = '[send-to-readest]';
const PORT_NAME = 'send-to-readest:capture';

function snapshot(): PageSnapshot {
  const sourceUrl =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href;
  return {
    sourceUrl,
    pageTitle: document.title || sourceUrl,
    html: document.documentElement.outerHTML,
  };
}

function run(): void {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
  } catch (err) {
    console.warn(LOG, 'failed to open port', err);
    return;
  }

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      console.warn(LOG, 'port closed early', chrome.runtime.lastError.message);
    }
  });

  try {
    port.postMessage({ snapshot: snapshot() });
  } catch (err) {
    console.warn(LOG, 'snapshot threw', err);
    port.postMessage({
      snapshot: null,
      reason: err instanceof Error ? err.message : String(err),
    });
  } finally {
    try {
      port.disconnect();
    } catch {
      /* already closed */
    }
  }
}

run();
