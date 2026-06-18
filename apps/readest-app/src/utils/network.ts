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
 * inconclusive. Used to gate silent Word Lens pack auto-downloads.
 */
export const isMetered = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as NavWithConnection).connection;
  if (!connection) return false;
  return connection.type === 'cellular' || connection.saveData === true;
};

/** Whether a dotted-decimal IPv4 address falls in a private / reserved range. */
function isBlockedV4(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Canonical SSRF host blocklist, shared by every server route that fetches a
 * client-supplied URL (`/api/opds/proxy`, `/api/kosync`, `/api/send/fetch-url`).
 * Returns true for hosts that must never be reached: loopback, private,
 * link-local, CGNAT, benchmarking, multicast, internal hostname suffixes, and
 * bare single-label names.
 *
 * Input is a hostname as the WHATWG URL parser serializes it (decimal/hex/octal
 * IPv4 already normalized to dotted-quad). This is a string check — a hostname
 * that DNS-resolves to a private address (DNS rebinding) is a documented
 * residual risk; the hosted web build runs on the Cloudflare Workers edge,
 * which has no reachable internal network or metadata endpoint.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  // Bare single-label hostnames (e.g. `intranet`, `metadata`) — never public.
  if (!h.includes('.') && !h.includes(':')) return true;

  // IPv4 — the WHATWG URL parser already normalized decimal/hex/octal forms.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return isBlockedV4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }

  // IPv6, including IPv4-mapped / -compatible forms.
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true; // unspecified, loopback
    if (/^(fc|fd)/.test(h)) return true; // unique-local
    if (/^fe[89ab]/.test(h)) return true; // link-local
    const mapped = h.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (mapped) {
      return isBlockedV4(
        Number(mapped[1]),
        Number(mapped[2]),
        Number(mapped[3]),
        Number(mapped[4]),
      );
    }
    const hexMapped = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1] ?? '0', 16);
      const lo = parseInt(hexMapped[2] ?? '0', 16);
      return isBlockedV4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
    return false;
  }
  return false;
}

/**
 * Whether a URL points at a LAN / internal address. Delegates to the canonical
 * {@link isBlockedHost} so the proxy SSRF guard and the LAN-detection callers
 * (KOSync direct-vs-proxy routing, OPDS catalog warnings) stay in sync.
 * Returns false for unparseable URLs (matching the previous best-effort
 * behavior — an invalid host can't be reached anyway).
 */
export const isLanAddress = (url: string): boolean => {
  try {
    return isBlockedHost(new URL(url).hostname);
  } catch {
    return false;
  }
};
