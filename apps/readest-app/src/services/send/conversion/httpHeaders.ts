/**
 * Browser-mimicking request headers for the URL-clip pipeline. The Tauri
 * Rust HTTP client (`@tauri-apps/plugin-http`) sends none of these by
 * default; bot-detection on Cloudflare, Medium, NYT and similar gates the
 * 403/429 on their *absence* as much as on a non-browser UA. Sending the
 * full Chrome set gets us past UA + header-fingerprint sniffing.
 *
 * Doesn't help against true session/JS challenges (verification screens,
 * paywalled members-only reads). Those need the browser extension.
 *
 * Shared with the future Phase 4 extension's service worker — it can
 * import the same constants and apply them on its own outbound fetches.
 */

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SEC_CH_UA = '"Chromium";v="124", "Not-A.Brand";v="99", "Google Chrome";v="124"';

/** Headers a real Chrome sends when navigating to a top-level URL. */
export function pageNavigateHeaders(): Record<string, string> {
  return {
    'user-agent': BROWSER_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  };
}

/** Headers a real Chrome sends when loading an image from a page. */
export function imageFetchHeaders(referer: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': BROWSER_UA,
    accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  };
  // Some CDNs gate image responses on a same-origin or page-origin Referer
  // (NYT, WSJ, many news image CDNs do this).
  if (referer) headers['referer'] = referer;
  return headers;
}

/**
 * True if the HTTP status code is the shape an anti-bot CDN typically
 * returns to a non-browser request — used to upgrade the user-facing error
 * to something explanatory instead of a bare status code.
 */
export function isLikelyBotBlock(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 503;
}
