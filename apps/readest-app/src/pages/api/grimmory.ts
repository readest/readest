import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { isLanAddress } from '@/utils/network';
import { publicFetch } from '@/utils/publicFetch';
import type { GrimmoryProxyPayload } from '@/services/grimmory/types';

const validPaths: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/api\/v1\/auth\/login$/ },
  { method: 'GET', path: /^\/api\/v1\/version$/ },
  { method: 'GET', path: /^\/api\/v1\/books$/ },
  { method: 'GET', path: /^\/api\/v1\/books\/\d+$/ },
  { method: 'GET', path: /^\/api\/v1\/books\/\d+\/content(\?bookType=[A-Za-z0-9_]+)?$/ },
  { method: 'POST', path: /^\/api\/v1\/books\/(progress|status)$/ },
  { method: 'GET', path: /^\/api\/v1\/(annotations|bookmarks)\/book\/\d+$/ },
  { method: 'POST', path: /^\/api\/v1\/(annotations|bookmarks)$/ },
  { method: 'PUT', path: /^\/api\/v1\/(annotations|bookmarks)\/\d+$/ },
  { method: 'DELETE', path: /^\/api\/v1\/(annotations|bookmarks)\/\d+$/ },
  { method: 'GET', path: /^\/api\/v1\/reading-sessions\/book\/\d+\?page=\d+&size=\d+$/ },
  { method: 'POST', path: /^\/api\/v1\/reading-sessions$/ },
];

export const isValidGrimmoryRequest = (method: string, path: string): boolean =>
  validPaths.some((entry) => entry.method === method && entry.path.test(path));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { serverUrl, path, method, headers, body } = req.body as GrimmoryProxyPayload;
  if (!serverUrl || !path || !method) {
    return res.status(400).json({ error: 'serverUrl, path and method are required' });
  }
  if (!isValidGrimmoryRequest(method, path)) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only http and https URLs are allowed' });
    }
    // A sub-path is allowed, but no credentials, query or fragment: a `?` or
    // `#` would swallow the allowlisted path and send the request elsewhere.
    if (parsed.username || parsed.password || serverUrl.includes('?') || serverUrl.includes('#')) {
      return res.status(400).json({ error: 'Invalid serverUrl' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid serverUrl' });
  }
  if (isLanAddress(serverUrl)) {
    return res
      .status(400)
      .json({ error: 'Requests to private/internal addresses are not allowed' });
  }

  let basePath = parsed.pathname;
  while (basePath.endsWith('/')) basePath = basePath.slice(0, -1);

  try {
    const response = await publicFetch(`${parsed.origin}${basePath}${path}`, {
      method,
      headers: headers ?? {},
      body: body ?? null,
    });
    // Never follow redirects: a 3xx could steer the proxy onto a private
    // address the isLanAddress gate above rejected (redirect-based SSRF).
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(`Redirects are not followed (status ${response.status})`);
    }
    res.status(response.status);
    for (const name of ['content-type', 'content-range']) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[GRIMMORY PROXY] Error:', error);
    const details = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ error: 'Proxy request failed', details });
  }
}
