import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { KoSyncProxyPayload } from '@/types/kosync';

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

  const targetUrl = `${serverUrl.replace(/\/$/, '')}${endpoint}`;

  try {
    const response = await fetch(targetUrl, {
      method: method,
      headers: {
        ...clientHeaders,
        Accept: 'application/vnd.koreader.v1+json',
        'Content-Type': 'application/json',
      },
      body: clientBody ? JSON.stringify(clientBody) : null,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Invalid sync server response: Unexpected Content-Type.');
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
