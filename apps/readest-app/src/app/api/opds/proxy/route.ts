import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { NextRequest, NextResponse } from 'next/server';
import { deserializeOPDSCustomHeaders } from '@/app/opds/utils/customHeaders';

async function handleRequest(request: NextRequest, method: 'GET' | 'HEAD') {
  // Cloudflare Workers incorrectly decodes %26 to & in the url parameter value,
  // causing query parameters within the proxied URL (like &start_index=26) to be
  // treated as separate top-level parameters instead of part of the url value.
  // We work around this by manually extracting the url parameter - capturing everything
  // from 'url=' until we hit our known parameters (&stream=, &auth=, or &headers=), then decoding it.
  const fullUrl = request.url;
  const urlParamStart = fullUrl.indexOf('url=') + 4;
  const streamParam = fullUrl.lastIndexOf('&stream=');
  const authParam = fullUrl.lastIndexOf('&auth=');
  const headersParam = fullUrl.lastIndexOf('&headers=');
  const urlParamEnd = Math.min(
    ...[streamParam, authParam, headersParam].filter((i) => i > 0),
    fullUrl.length,
  );
  const encodedUrl = fullUrl.substring(urlParamStart, urlParamEnd);
  const url = decodeURIComponent(encodedUrl);
  const auth = request.nextUrl.searchParams.get('auth');
  const stream = request.nextUrl.searchParams.get('stream');
  const customHeaders = deserializeOPDSCustomHeaders(request.nextUrl.searchParams.get('headers'));

  if (!url) {
    return NextResponse.json(
      { error: 'Missing URL parameter. Usage: /api/opds/proxy?url=YOUR_OPDS_URL' },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    console.log(`[OPDS Proxy] ${method}: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers = new Headers({
      'User-Agent': READEST_OPDS_USER_AGENT,
      Accept: 'application/atom+xml, application/xml, text/xml, application/json, */*',
    });

    for (const [key, value] of Object.entries(customHeaders)) {
      headers.set(key, value);
    }

    if (auth) {
      headers.set('Authorization', auth);
    }

    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[OPDS Proxy] HTTP ${response.status} for ${url}`);
      if (method === 'HEAD') {
        if (response.status === 401) {
          return new NextResponse(null, {
            status: 403,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          });
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.text();
      if (response.status === 401) {
        return new NextResponse(data, {
          status: 403,
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      return new NextResponse(data, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const contentType = response.headers.get('Content-Type') || 'text/xml';
    const contentLength = response.headers.get('Content-Length');
    const contentEncoding = response.headers.get('Content-Encoding');
    const transferEncoding = response.headers.get('Transfer-Encoding');
    const upstreamContentDisposition = response.headers.get('Content-Disposition');
    console.log(
      `[OPDS Proxy] upstream OK: ${url} ` +
        `content-type=${contentType} content-length=${contentLength ?? '(none)'} ` +
        `content-encoding=${contentEncoding ?? '(none)'} ` +
        `transfer-encoding=${transferEncoding ?? '(none)'} ` +
        `content-disposition=${upstreamContentDisposition ?? '(none)'}`,
    );

    // Headers that must NOT be forwarded as-is when we proxy the body:
    //  - content-encoding: fetch() has already decoded gzip/br/deflate, so
    //    the body the client receives is plain. Forwarding the original
    //    Content-Encoding makes the browser try to decode it again, which
    //    truncates or empties the response. This was the cause of
    //    Content-Length: 0 / 0-byte downloads from Calibre and similar.
    //  - content-length: must match the bytes we actually emit (post-decode).
    //    We set the right value below where we know it.
    //  - transfer-encoding / connection / keep-alive: hop-by-hop headers,
    //    must not cross the proxy boundary.
    const excludedHeaders = new Set([
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
      'keep-alive',
    ]);

    // Use a Headers object so name comparison is case-insensitive — this
    // prevents the `content-type` (lowercase from Headers.entries) and
    // `Content-Type` (title-case override) duplication that produced
    // "application/epub+zip, application/epub+zip" responses.
    const buildResponseHeaders = (extras: Record<string, string>) => {
      const h = new Headers();
      for (const [key, value] of response.headers.entries()) {
        if (!excludedHeaders.has(key.toLowerCase())) {
          h.set(key, value);
        }
      }
      // Don't cache file downloads — a single broken response would otherwise
      // be cached for 5 minutes and keep returning 0 bytes. Catalog feeds
      // (XML/JSON) are still cacheable.
      const isFileDownload =
        stream === 'true' ||
        (upstreamContentDisposition ?? '').toLowerCase().includes('attachment');
      h.set('Cache-Control', isFileDownload ? 'no-store' : 'public, max-age=300');
      h.set('Access-Control-Allow-Origin', '*');
      h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type');
      for (const [key, value] of Object.entries(extras)) {
        h.set(key, value);
      }
      return h;
    };

    if (method === 'HEAD') {
      console.log(`[OPDS Proxy] HEAD Success: ${url}`);
      return new NextResponse(null, {
        status: 200,
        headers: buildResponseHeaders({
          'Content-Type': contentType,
          ...(contentLength ? { 'Content-Length': contentLength } : {}),
        }),
      });
    }

    if (stream === 'true' && contentLength && parseInt(contentLength) > 1024 * 1024) {
      console.log(`[OPDS Proxy] Streaming: ${url} (${contentLength} bytes)`);
      const headers = buildResponseHeaders({
        'Content-Type': contentType,
        // Surface the upstream length to the client without setting the real
        // Content-Length header (which must match the streamed bytes — and
        // we let Next.js / the runtime compute that).
        'X-Content-Length': contentLength,
        'Access-Control-Expose-Headers': 'X-Content-Length',
      });
      return new NextResponse(response.body, { status: 200, headers });
    } else {
      const buf = await response.arrayBuffer();
      const length = buf.byteLength;
      console.log(`[OPDS Proxy] Buffered Success: ${url} (${length} bytes)`);
      return new NextResponse(buf, {
        status: 200,
        headers: buildResponseHeaders({
          'Content-Type': contentType,
          'Content-Length': length.toString(),
        }),
      });
    }
  } catch (error) {
    console.error('[OPDS Proxy] Error:', error);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timeout - the OPDS server took too long to respond' },
          { status: 504 },
        );
      }

      return NextResponse.json(
        {
          error: error.message,
          url: url,
          hint: 'Check if the OPDS URL is accessible and returns valid OPDS/Atom/JSON content',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: 'Failed to fetch OPDS feed', url: url }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handleRequest(request, 'HEAD');
}

export async function OPTIONS(_: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
