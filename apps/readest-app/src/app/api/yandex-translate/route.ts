import { NextRequest, NextResponse } from 'next/server';
import {
  YANDEX_ORIGIN,
  YANDEX_SESSION_URL,
  YANDEX_TRANSLATE_URL,
  YANDEX_USER_AGENT,
} from '@/services/translators/providers/yandexShared';

/**
 * Same-origin proxy for the Yandex Translate web API, used by the `yandex`
 * translation provider in web builds. The Yandex session endpoint requires a
 * translate.yandex.ru Referer, which a browser cannot send cross-origin, so
 * the client calls this route and the headers are attached server-side.
 * Only two fixed upstream endpoints are exposed — no arbitrary URL is ever
 * fetched, so there is no SSRF surface.
 */
const ENDPOINTS: Record<string, string> = {
  session: YANDEX_SESSION_URL,
  translate: YANDEX_TRANSLATE_URL,
};

// The provider chunks texts at 600 chars; anything much larger is abuse.
const MAX_BODY_CHARS = 100_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 60;
const MAX_CONCURRENT_REQUESTS = 3;
const UPSTREAM_TIMEOUT_MS = 15_000;

const requestBudgets = new Map<string, { count: number; resetAt: number; active: number }>();
// Read lazily so tests and deployments can override it via the env var.
// Invalid values (non-positive, NaN, Infinity) fall back to the default —
// AbortSignal.timeout() would abort immediately or throw otherwise.
const upstreamTimeoutMs = () => {
  const value = Number(process.env['YANDEX_UPSTREAM_TIMEOUT_MS']);
  return Number.isFinite(value) && value > 0 ? value : UPSTREAM_TIMEOUT_MS;
};
// Response constructor throws when these statuses carry a body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const getClientId = (request: NextRequest) =>
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-real-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  'unknown';

export async function POST(request: NextRequest) {
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
  const upstream = endpoint ? ENDPOINTS[endpoint] : undefined;
  if (!upstream) {
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
  }

  const now = Date.now();
  const clientId = getClientId(request);
  let budget = requestBudgets.get(clientId);
  if (!budget || budget.resetAt <= now) {
    budget = {
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
      active: budget?.active ?? 0,
    };
    requestBudgets.set(clientId, budget);
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

    const url = new URL(upstream);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== 'endpoint') url.searchParams.append(key, value);
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': YANDEX_USER_AGENT,
          Origin: YANDEX_ORIGIN,
          Referer: `${YANDEX_ORIGIN}/`,
        },
        body,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(upstreamTimeoutMs())]),
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
