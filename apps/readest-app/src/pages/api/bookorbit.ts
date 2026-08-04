import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { isLanAddress } from '@/utils/network';
import type { BookOrbitProxyPayload } from '@/types/bookorbit';

const validEndpoints = [
  /^\/users\/auth$/,
  /^\/plugin\/version$/,
  /^\/plugin\/match-check$/,
  /^\/plugin\/annotations\/exchange(-ack)?$/,
  /^\/plugin\/bookmarks\/exchange(-ack)?$/,
  /^\/plugin\/page-stats$/,
  /^\/plugin\/book-states$/,
];

export const isValidBookOrbitEndpoint = (endpoint: string): boolean =>
  validEndpoints.some((regex) => regex.test(endpoint));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  const {
    serverUrl,
    endpoint,
    method,
    headers: clientHeaders,
    body: clientBody,
  } = req.body as BookOrbitProxyPayload;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!serverUrl || !endpoint) {
    return res.status(400).json({ error: 'serverUrl and endpoint are required' });
  }

  if (!isValidBookOrbitEndpoint(endpoint)) {
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

  const targetUrl = `${serverUrl.replace(/\/$/, '')}/api/v1/koreader${endpoint}`;

  try {
    const response = await fetch(targetUrl, {
      method: method,
      headers: {
        ...clientHeaders,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: clientBody ? JSON.stringify(clientBody) : null,
      // Never follow redirects: a public server answering 3xx could steer the
      // proxy onto a private address that the isLanAddress gate above already
      // rejected (redirect-based SSRF).
      redirect: 'error',
    });

    const data = await response.text();
    res.status(response.status);
    try {
      res.json(JSON.parse(data));
    } catch {
      res.send(data);
    }
  } catch (error) {
    console.error('[BOOKORBIT PROXY] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ error: 'Proxy request failed', details: errorMessage });
  }
}
