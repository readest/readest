/**
 * Which tabs the clipper will act on, and the extra permission a locally
 * opened page needs.
 *
 * Beyond remote pages we accept `file://` tabs — a saved web page, an
 * exported HTML/XHTML document, anything the user opened straight off
 * disk. The converter treats those exactly like a remote page (site rule
 * → Readability → EPUB); only the assets differ, since nothing on a
 * `file://` page is fetchable from an extension context.
 *
 * Everything else stays out: `chrome://`, `devtools://`, `about:`,
 * `data:`, `javascript:` and the Web Store are either uninjectable or
 * carry nothing worth clipping.
 */

export function isClippableUrl(url: string | undefined): url is string {
  return !!url && /^(https?|file):/i.test(url);
}

export function isLocalFileUrl(url: string | undefined): boolean {
  return !!url && /^file:/i.test(url);
}

/**
 * Chrome gates `file://` access behind a per-extension user toggle
 * ("Allow access to file URLs" on the extension's own settings page);
 * `<all_urls>` alone is not enough. Without it `chrome.scripting.
 * executeScript` fails on a local tab with an opaque host-permission
 * error, so both the popup and the service worker check first and point
 * the user at the toggle instead.
 *
 * Fails OPEN. `chrome.extension` is a trimmed-down MV3 surface and parts
 * of it are foreground-only, so a service worker may not have this method
 * at all. "Can't tell" must not read as "denied" — that would block every
 * local clip on a browser where the toggle is already on. When we can't
 * ask, let the clip run and surface whatever real error the inject hits.
 */
export async function hasFileSchemeAccess(): Promise<boolean> {
  try {
    const allowed = await chrome.extension?.isAllowedFileSchemeAccess?.();
    return allowed !== false;
  } catch {
    return true;
  }
}

/** The extension's own row on `chrome://extensions`, where the toggle lives. */
export function extensionSettingsUrl(): string {
  return `chrome://extensions/?id=${chrome.runtime.id}`;
}
