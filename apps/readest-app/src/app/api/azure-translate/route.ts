import { NextRequest, NextResponse } from 'next/server';
import {
  BING_REQUEST_HEADERS,
  BING_TRANSLATE_URL,
  BING_TRANSLATOR_URL,
  parseBingAuthParams,
} from '@/services/translators/providers/azureShared';
import { validateUserAndToken } from '@/utils/access';

/**
 * Same-origin proxy for the Bing Translator web API, used by the `azure`
 * translation provider in web builds. bing.com sends no CORS headers at all,
 * so a browser cannot call it directly; the client calls this route and the
 * request is made server-side.
 * Only two fixed upstream endpoints are exposed — no arbitrary URL is ever
 * fetched, so there is no SSRF surface.
 *
 * The `auth` endpoint parses the ~650KB translator page here and returns only
 * the auth material, so that markup never crosses the wire to the browser.
 */
const MAX_BODY_CHARS = 100_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 60;
const MAX_CONCURRENT_REQUESTS = 3;
const UPSTREAM_TIMEOUT_MS = 15_000;

const requestBudgets = new Map<string, { count: number; resetAt: number; active: number }>();
// Response constructor throws when these statuses carry a body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export async function POST(request: NextRequest) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    // leave originHost null — treated as a mismatch below
  }
  if (originHost !== request.nextUrl.host) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const endpoint = request.nextUrl.searchParams.get('endpoint');
  if (endpoint !== 'auth' && endpoint !== 'translate') {
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
  }

  const now = Date.now();
  let budget = requestBudgets.get(user.id);
  if (!budget || budget.resetAt <= now) {
    budget = {
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
      active: budget?.active ?? 0,
    };
    requestBudgets.set(user.id, budget);
  }
  if (budget.count >= RATE_LIMIT_REQUESTS || budget.active >= MAX_CONCURRENT_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((budget.resetAt - now) / 1000)) } },
    );
  }
  budget.count++;
  budget.active++;

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);

    if (endpoint === 'auth') {
      try {
        const response = await fetch(BING_TRANSLATOR_URL, {
          method: 'GET',
          headers: { 'User-Agent': BING_REQUEST_HEADERS['User-Agent'] },
          signal,
        });
        if (!response.ok) {
          return NextResponse.json(
            { error: 'Upstream request failed' },
            { status: response.status },
          );
        }
        return NextResponse.json(parseBingAuthParams(await response.text(), Date.now()));
      } catch {
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
      }
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength !== null) {
      const declaredLength = Number(contentLength);
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > MAX_BODY_CHARS * 3
      ) {
        return NextResponse.json({ error: 'Invalid request body size' }, { status: 413 });
      }
    }
    const body = await request.text();
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }

    const url = new URL(BING_TRANSLATE_URL);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'endpoint') url.searchParams.append(key, value);
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: BING_REQUEST_HEADERS,
        body,
        signal,
      });
      const responseBody = NULL_BODY_STATUSES.has(response.status) ? null : await response.text();
      return new NextResponse(responseBody, {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
      });
    } catch {
      return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
    }
  } finally {
    budget.active--;
  }
}
