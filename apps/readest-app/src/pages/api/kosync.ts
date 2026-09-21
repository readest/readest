import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { isLanAddress } from '@/utils/network';
import { KoSyncProxyPayload } from '@/types/kosync';

const validEndpoints = [
  /^\/users\/create$/,
  /^\/users\/auth$/,
  /^\/syncs\/progress(?:\/[a-fA-F0-9]{32})?$/,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  const {
    serverUrl,
    endpoint,
    method,
    headers: clientHeaders,
    body: clientBody,
  } = req.body as KoSyncProxyPayload;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!serverUrl || !endpoint) {
    return res.status(400).json({ error: 'serverUrl and endpoint are required' });
  }

  if (!validEndpoints.some((regex) => regex.test(endpoint))) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only http and https URLs are allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid serverUrl' });
  }

  if (isLanAddress(serverUrl)) {
    return res
      .status(400)
      .json({ error: 'Requests to private/internal addresses are not allowed' });
  }

  let targetUrl = `${serverUrl.replace(/\/$/, '')}${endpoint}`;

  try {
    let requestMethod = method;
    let body = clientBody ? JSON.stringify(clientBody) : null;
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await fetch(targetUrl, {
        method: requestMethod,
        headers: {
          ...clientHeaders,
          Accept: 'application/vnd.koreader.v1+json',
          'Content-Type': 'application/json',
        },
        body,
        redirect: 'manual',
      });
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      const current = new URL(targetUrl);
      const next = new URL(location, current);
      const httpsUpgrade =
        current.protocol === 'http:' &&
        next.protocol === 'https:' &&
        current.hostname === next.hostname &&
        next.port === '';
      await response.body?.cancel();
      if (
        hop >= 5 ||
        isLanAddress(next.href) ||
        next.username ||
        next.password ||
        (next.origin !== current.origin && !httpsUpgrade)
      ) {
        throw new Error('Redirect destination is not allowed');
      }
      if (
        response.status === 303 ||
        ([301, 302].includes(response.status) && requestMethod === 'POST')
      ) {
        requestMethod = 'GET';
        body = null;
      }
      targetUrl = next.href;
    }

    const data = await response.text();
    res.status(response.status);
    try {
      res.json(JSON.parse(data));
    } catch {
      res.send(data);
    }
  } catch (error) {
    console.error('[KOSYNC PROXY] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ error: 'Proxy request failed', details: errorMessage });
  }
}
