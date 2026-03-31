import { NextRequest, NextResponse } from 'next/server';

/**
 * Shadow Library Proxy API
 * 
 * Proxies requests to shadow library providers to bypass CORS
 * and handle authentication uniformly.
 */

const READEST_SHADOW_LIBRARY_USER_AGENT = 'Readest/1.0 (Shadow Library Client)';

/**
 * Allowed hostnames for the proxy. Only shadow library domains are permitted
 * to prevent this endpoint from being used as an open SSRF proxy.
 */
const ALLOWED_HOSTS = new Set([
  // Library Genesis mirrors
  'libgen.li',
  'libgen.is',
  'libgen.rs',
  'libgen.st',
  'libgen.pw',
  'libgen.fun',
  // Library Genesis CDN / download mirrors
  'download.library.lol',
  'library.lol',
  // Anna's Archive
  'annas-archive.org',
  'annas-archive.se',
  // Sci-Hub mirrors
  'sci-hub.se',
  'sci-hub.st',
  'sci-hub.ru',
  // Unpaywall (open access, legitimate)
  'api.unpaywall.org',
]);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing URL parameter. Usage: /api/shadow-library/proxy?url=TARGET_URL' },
      { status: 400 }
    );
  }

  // Validate URL format
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return NextResponse.json(
      { error: 'Invalid URL. Must start with http:// or https://' },
      { status: 400 }
    );
  }

  // Allowlist check — prevents this endpoint from acting as an open SSRF proxy
  let targetHostname: string;
  try {
    targetHostname = new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch {
    return NextResponse.json({ error: 'Malformed URL' }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(targetHostname)) {
    return NextResponse.json(
      { error: `Domain not permitted: ${targetHostname}` },
      { status: 403 },
    );
  }

  try {
    console.log(`[Shadow Library Proxy] GET: ${targetUrl}`);

    const headers = new Headers({
      'User-Agent': READEST_SHADOW_LIBRARY_USER_AGENT,
      Accept: 'application/json, text/html, application/pdf, */*',
    });

    // Forward auth header if provided
    const authHeader = searchParams.get('auth');
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      // Allow invalid certificates for shadow libraries
      // @ts-ignore - Tauri specific
      danger: { acceptInvalidCerts: true },
    });

    clearTimeout(timeoutId);

    console.log(`[Shadow Library Proxy] Response: ${response.status}`);

    // Handle errors
    if (!response.ok) {
      console.error(`[Shadow Library Proxy] HTTP ${response.status} for ${targetUrl}`);
      
      return NextResponse.json(
        {
          error: `Request failed with status ${response.status}`,
          url: targetUrl,
          status: response.status,
        },
        { status: response.status }
      );
    }

    // Get content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Handle PDF streaming
    if (contentType.includes('application/pdf')) {
      const arrayBuffer = await response.arrayBuffer();
      return new NextResponse(arrayBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="document.pdf"`,
        },
      });
    }

    // Handle JSON
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    // Handle binary content: images and ebook formats
    // Must come before the text fallback to avoid corrupting binary data
    const isBinary =
      contentType.startsWith('image/') ||
      contentType.includes('application/epub+zip') ||
      contentType.includes('application/x-mobipocket') ||
      contentType.includes('application/x-fictionbook') ||
      contentType.includes('application/vnd.amazon.ebook') ||
      contentType.includes('application/octet-stream') ||
      contentType.includes('application/zip');

    if (isBinary) {
      const arrayBuffer = await response.arrayBuffer();
      return new NextResponse(arrayBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': contentType.startsWith('image/') ? 'public, max-age=86400' : 'no-store',
        },
      });
    }

    // Handle HTML/text
    const text = await response.text();
    return new NextResponse(text, {
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('[Shadow Library Proxy] Error:', error);

    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        return NextResponse.json(
          {
            error: 'Request timeout - the shadow library server took too long to respond',
            hint: 'Try switching to a different mirror',
          },
          { status: 504 }
        );
      }

      return NextResponse.json(
        {
          error: `Failed to fetch: ${error.message}`,
          url: targetUrl,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch shadow library', url: targetUrl },
      { status: 500 }
    );
  }
}

/**
 * HEAD request for health checking
 */
export async function HEAD(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    const hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
    if (!ALLOWED_HOSTS.has(hostname)) {
      return NextResponse.json({ error: `Domain not permitted: ${hostname}` }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Malformed URL' }, { status: 400 });
  }

  try {
    console.log(`[Shadow Library Proxy] HEAD: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': READEST_SHADOW_LIBRARY_USER_AGENT,
      },
      // @ts-ignore - Tauri specific
      danger: { acceptInvalidCerts: true },
    });

    console.log(`[Shadow Library Proxy] HEAD Response: ${response.status}`);

    return new NextResponse(null, {
      status: response.status,
      headers: {
        'X-Response-Time': response.headers.get('x-response-time') || '0',
      },
    });
  } catch (error) {
    console.error('[Shadow Library Proxy] HEAD Error:', error);
    return NextResponse.json(
      { error: 'Health check failed' },
      { status: 500 }
    );
  }
}

/**
 * POST request for search queries
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    const body = await request.json();
    console.log(`[Shadow Library Proxy] POST: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'User-Agent': READEST_SHADOW_LIBRARY_USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // @ts-ignore - Tauri specific
      danger: { acceptInvalidCerts: true },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Request failed with status ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    const text = await response.text();
    return new NextResponse(text);
  } catch (error) {
    console.error('[Shadow Library Proxy] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
