import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { isBlockedHost } from '@/utils/network';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// `isBlockedHost` now lives in the shared network helper so every URL-fetching
// route (this `/send` proxy, `/api/opds/proxy`, `/api/kosync`) uses one
// canonical SSRF blocklist. Re-exported here for existing importers/tests.
export { isBlockedHost };

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
