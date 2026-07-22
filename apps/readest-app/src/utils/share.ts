import { writeTextToClipboard } from '@/utils/clipboard';
import { READEST_WEB_BASE_URL, SHARE_BASE_URL, SHARE_TOKEN_LENGTH } from '@/services/constants';

export interface ShareDeepLink {
  token: string;
  // Reserved for future query params (e.g., recipient locale, share variant).
  // Currently no params are emitted, but parseShareDeepLink preserves the
  // shape so callers don't need to be updated when more arrive.
}

const TOKEN_RE = new RegExp(`^[A-Za-z0-9]{${SHARE_TOKEN_LENGTH}}$`);

const isValidToken = (raw: unknown): raw is string => typeof raw === 'string' && TOKEN_RE.test(raw);

// Canonical share URL embedded in the dialog, share sheet, and any "copy link"
// affordance. Always points at the public web target.
export const buildShareUrl = (token: string): string => `${SHARE_BASE_URL}/${token}`;

// Parses both the custom-scheme and HTTPS forms used by the deeplink ingress.
//   readest://share/{token}
//   https://web.readest.com/s/{token}
// Returns null on invalid input so callers can fall through to other parsers.
export const parseShareDeepLink = (url: string): ShareDeepLink | null => {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'readest:') {
    // For readest://share/{token} the host portion holds the path segment
    // before the slash. Use pathname for the token; url.host == 'share'.
    if (parsed.host !== 'share') return null;
    const token = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return isValidToken(token) ? { token } : null;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    if (!isWebReadestHost(parsed.host)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 's') return null;
    const token = segments[1]!;
    return isValidToken(token) ? { token } : null;
  }
  return null;
};

export interface SharePosition {
  x: number;
  y: number;
  preferredEdge?: 'top' | 'bottom' | 'left' | 'right';
}

/** Minimal slice of AppService needed to decide the native-share path. */
interface ShareCapableService {
  isMobileApp?: boolean;
  isMacOSApp?: boolean;
}

/**
 * Whether the selected text can be shared by ANY method on this platform —
 * native sharekit (mobile/macOS) or the Web Share API. Used to gate the Share
 * tool's visibility in the selection toolbar and its customizer. Kept next to
 * `shareSelectedText` so the two stay in sync.
 */
export const canShareText = (appService?: ShareCapableService | null): boolean =>
  !!appService?.isMobileApp ||
  !!appService?.isMacOSApp ||
  (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/**
 * Open the OS share sheet for `text`, with graceful fallbacks.
 *
 * Ladder:
 *  1. Native sharekit on mobile + macOS only. Windows/Linux are excluded: the
 *     plugin's share UI can freeze the app on Windows (issue #4343) and is not
 *     functional on Linux — `nativeAppService` gates `shareFile` the same way.
 *  2. `navigator.share` (web / PWA). A rejection means the user dismissed the
 *     sheet — respect it, don't silently copy.
 *  3. Clipboard, as a last resort when no share method exists.
 */
export const shareSelectedText = async (
  text: string,
  position?: SharePosition,
  appService?: ShareCapableService | null,
): Promise<void> => {
  if (!text) return;

  if (appService?.isMobileApp || appService?.isMacOSApp) {
    try {
      const { shareText } = await import('@choochmeque/tauri-plugin-sharekit-api');
      await shareText(text, { position });
      return;
    } catch (err) {
      console.error('shareText failed; falling back:', err);
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      // Only respect a user cancel (AbortError). Other failures — e.g.
      // NotAllowedError when a quick action fires without a user gesture —
      // fall through to the clipboard so the user still gets the text.
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  await writeTextToClipboard(text);
};

const isWebReadestHost = (host: string): boolean => {
  // Matches the production host and any preview domain Readest may serve from.
  // Conservative: accepts only the exact production host or a *.readest.com
  // subdomain so a third-party site cannot impersonate a share URL.
  if (host === new URL(READEST_WEB_BASE_URL).host) return true;
  return host.endsWith('.readest.com');
};
