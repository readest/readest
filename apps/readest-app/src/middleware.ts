import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [
  'https://web.readest.com',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'tauri://localhost',
];

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Baseline security headers applied to every response. `nosniff` stops the
// browser MIME-sniffing a response into an executable type; `Referrer-Policy`
// avoids leaking full URLs (which carry share tokens) cross-origin; HSTS pins
// HTTPS for the apex. `includeSubDomains`/`preload` are intentionally omitted:
// other *.readest.com hosts (e.g. the assets domain) are out of scope here and
// must not be forced onto HSTS from this app.
const applySecurityHeaders = (response: NextResponse): NextResponse => {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000');
  return response;
};

export function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');

  if (isApi) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowedOrigin = allowedOrigins.includes(origin);

    if (request.method === 'OPTIONS') {
      // Echo the requested headers rather than answering `*`: the Fetch spec
      // excludes `Authorization` from wildcard matching in the browser's
      // preflight cache, so a wildcard answer forces a fresh OPTIONS round
      // trip before every authenticated API call despite Max-Age.
      const requestedHeaders = request.headers.get('access-control-request-headers');
      const preflightHeaders = new Headers({
        ...corsOptions,
        'Access-Control-Allow-Headers': requestedHeaders || 'Authorization, Content-Type',
        Vary: 'Origin, Access-Control-Request-Headers',
        ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
      });

      return new NextResponse(null, {
        status: 200,
        headers: preflightHeaders,
      });
    }

    const response = NextResponse.next();

    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }

    Object.entries(corsOptions).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return applySecurityHeaders(response);
  }

  // Cross-origin isolation enables SharedArrayBuffer, which the Turso WASM
  // thread pool requires (initThreadPool hangs without it). Set on every
  // document response, not just /api/* — `crossOriginIsolated` is a property
  // of the top-level browsing context, determined by the document's headers.
  const response = NextResponse.next();
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The /s share landing embeds the book cover via an <img> that redirects to a
  // cross-origin R2 presigned URL. Under COEP: require-corp the browser blocks
  // that image, because R2 can't attach a Cross-Origin-Resource-Policy header to
  // a presigned GET. `credentialless` keeps the page cross-origin isolated — so
  // EnvContext can still boot the Turso replica (SharedArrayBuffer) here when the
  // user has sync enabled — while dropping the CORP requirement for no-cors
  // subresources, letting the cover load with no client-side change. Every other
  // route keeps the stricter require-corp.
  const path = request.nextUrl.pathname;
  const coep = path === '/s' || path.startsWith('/s/') ? 'credentialless' : 'require-corp';
  response.headers.set('Cross-Origin-Embedder-Policy', coep);
  // The access token is stored in localStorage, so a clickjacked frame of
  // Readest is an account-takeover vector. Restrict framing to same-origin.
  // Kept as a minimal, enforce-safe CSP (framing only) so it cannot break
  // script/style/connect loading the way a full content policy might; a full
  // Report-Only CSP can be layered on later.
  response.headers.set('Content-Security-Policy', "frame-ancestors 'self'");
  return applySecurityHeaders(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)'],
};
