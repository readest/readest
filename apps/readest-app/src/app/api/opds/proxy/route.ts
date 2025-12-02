import { NextRequest, NextResponse } from 'next/server';

async function handleRequest(request: NextRequest, method: 'GET' | 'HEAD') {
  // Cloudflare Workers incorrectly decodes %26 to & in the url parameter value,
  // causing query parameters within the proxied URL (like &start_index=26) to be
  // treated as separate top-level parameters instead of part of the url value.
  // We work around this by manually extracting the url parameter - capturing everything
  // from 'url=' until we hit our known parameters (&stream= or &auth=), then decoding it.
  const fullUrl = request.url;
  const urlParamStart = fullUrl.indexOf('url=') + 4;
  const streamParam = fullUrl.lastIndexOf('&stream=');
  const authParam = fullUrl.lastIndexOf('&auth=');
  const urlParamEnd = Math.min(...[streamParam, authParam].filter((i) => i > 0), fullUrl.length);
  const encodedUrl = fullUrl.substring(urlParamStart, urlParamEnd);
  const url = decodeURIComponent(encodedUrl);
  const auth = request.nextUrl.searchParams.get('auth');
  const stream = request.nextUrl.searchParams.get('stream');

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
    const timeout = setTimeout(() => controller.abort(), 10000);
    const headers: HeadersInit = {
      'User-Agent': 'Readest/1.0 (OPDS Browser)',
      Accept: 'application/atom+xml, application/xml, text/xml, application/json, */*',
    };

    if (auth) {
      headers['Authorization'] = auth;
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
              'Cache-Control': 'public, max-age=300',
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
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type') || 'text/xml';
    const contentLength = response.headers.get('Content-Length');

    if (method === 'HEAD') {
      console.log(`[OPDS Proxy] HEAD Success: ${url}`);
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength || '',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (stream === 'true' || (contentLength && parseInt(contentLength) > 1024 * 1024)) {
      console.log(`[OPDS Proxy] Streaming: ${url}`);

      return new NextResponse(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'X-Content-Length': contentLength || '',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    } else {
      const data = await response.text();
      console.log(`[OPDS Proxy] Success: ${url} (${data.length} bytes)`);

      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
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
