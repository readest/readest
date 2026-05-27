import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Whether a dotted-decimal IPv4 address falls in a private / reserved range. */
function isBlockedV4(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Block obviously-internal hosts. A browser cannot fetch arbitrary cross-origin
 * pages (CORS), so the web `/send` page routes article URLs through this proxy
 * — which means the server makes the request, so an SSRF guard is mandatory.
 * The Tauri apps fetch directly and never hit this route.
 *
 * Note: this is a string check on the URL host. A hostname that DNS-resolves to
 * a private address (DNS rebinding) is a documented residual risk — the web
 * build runs on the Cloudflare Workers edge, which has no reachable internal
 * network or metadata endpoint.
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

/** GET ?url=... — fetch a remote page's HTML for client-side article extraction. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user } = await validateUserAndToken(req.headers['authorization']);
  if (!user) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const target = String(req.query['url'] ?? '');
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http(s) URLs are supported' });
  }
  if (isBlockedHost(parsed.hostname)) {
    return res.status(400).json({ error: 'This URL is not allowed' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so the SSRF host check runs on EVERY hop —
    // `redirect: 'follow'` would let a public URL 302 to an internal address.
    let currentUrl = parsed.toString();
    let upstream: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const hopHost = new URL(currentUrl).hostname;
      if (isBlockedHost(hopHost)) {
        return res.status(400).json({ error: 'This URL is not allowed' });
      }
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'ReadestBot/1.0 (+https://readest.com)' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return res.status(502).json({ error: 'Redirect without a location' });
        }
        currentUrl = new URL(location, currentUrl).toString();
        const proto = new URL(currentUrl).protocol;
        if (proto !== 'http:' && proto !== 'https:') {
          return res.status(400).json({ error: 'Redirect to an unsupported scheme' });
        }
        continue;
      }
      upstream = response;
      break;
    }
    if (!upstream) {
      return res.status(502).json({ error: 'Too many redirects' });
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return res.status(415).json({ error: 'URL did not return an HTML page' });
    }
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
      return res.status(413).json({ error: 'Page is too large' });
    }
    const html = new TextDecoder('utf-8').decode(buffer);
    return res.status(200).json({ html, finalUrl: upstream.url });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return res.status(504).json({ error: 'Fetching the URL timed out' });
    }
    return res.status(502).json({ error: 'Could not fetch the URL' });
  } finally {
    clearTimeout(timer);
  }
}
