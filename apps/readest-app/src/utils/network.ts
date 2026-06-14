/**
 * Network Information API surface we care about. It's non-standard and absent
 * on iOS Safari / Tauri webviews, so everything is optional and `isMetered`
 * falls through to `false` (treat as unmetered) when it can't tell.
 */
type NavWithConnection = Navigator & {
  connection?: { type?: string; saveData?: boolean };
};

/**
 * Best-effort metered-connection detection. Returns `true` only when the
 * Network Information API positively reports a cellular connection or the
 * user's data-saver preference; returns `false` when the API is unavailable or
 * inconclusive. Used to gate silent Word Wise pack auto-downloads.
 */
export const isMetered = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as NavWithConnection).connection;
  if (!connection) return false;
  return connection.type === 'cellular' || connection.saveData === true;
};

export const isLanAddress = (url: string) => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }

    // Check for IPv4 private ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);

    if (match) {
      const [, a, b, c, d] = match.map(Number);
      if (a === undefined || b === undefined || c === undefined || d === undefined) {
        return false;
      }

      // Validate IP format
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return false;
      }

      // Check private IP ranges:
      // 10.0.0.0/8 (10.0.0.0 to 10.255.255.255)
      if (a === 10) return true;

      // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16 (192.168.0.0 to 192.168.255.255)
      if (a === 192 && b === 168) return true;

      // 169.254.0.0/16 (link-local addresses)
      if (a === 169 && b === 254) return true;

      // Tailscale IPv4 range: 100.64.0.0/10 (100.64.0.0 to 100.127.255.255)
      if (a === 100 && b >= 64 && b <= 127) return true;
    }

    // Check for IPv6 private addresses
    // URL.hostname wraps IPv6 in brackets, e.g. '[::1]' — strip them
    const ipv6 = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    if (ipv6.includes(':')) {
      if (
        ipv6 === '::1' ||
        ipv6.startsWith('fe80:') ||
        ipv6.startsWith('fc00:') ||
        ipv6.startsWith('fd00:')
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
};
