import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  const { path } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : path || '';

  const apiUrl = process.env['NEXT_PUBLIC_BIBLO_API_URL'] || 'http://localhost:3001/api/v0';
  const queryStr = req.url?.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = `${apiUrl}/marketing/${pathStr}${queryStr}`;

  try {
    const headers: Record<string, string> = {};
    const reqContentType = req.headers['content-type'];
    if (reqContentType) {
      headers['Content-Type'] = reqContentType as string;
    }
    if (req.headers.authorization) {
      headers['authorization'] = req.headers.authorization;
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // For read book endpoint, it streams binary. Check content-type.
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      if (req.method === 'HEAD') {
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        const acceptRanges = response.headers.get('accept-ranges');
        if (acceptRanges) {
          res.setHeader('Accept-Ranges', acceptRanges);
        }
        return res.status(response.status).end();
      }

      // Forward the binary data directly for the book files
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges) {
        res.setHeader('Accept-Ranges', acceptRanges);
      }
      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      return res.status(response.status).send(buffer);
    }
  } catch (error: any) {
    console.error('Error proxying marketing request to Express backend:', error);
    return res.status(500).json({ error: 'Internal Server Error proxying to backend' });
  }
}
