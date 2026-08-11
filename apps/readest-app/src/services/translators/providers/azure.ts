import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';
import { splitTextIntoChunks } from '../utils';
import { normalizeToShortLang } from '@/utils/lang';
import {
  BING_REQUEST_HEADERS,
  BING_TRANSLATE_URL,
  BING_TRANSLATOR_URL,
  BingAuthParams,
  isBingAuthParams,
  parseBingAuthParams,
} from './azureShared';

/**
 * Microsoft's free translation backend, reached the same way the Bing
 * Translator frontend reaches it. The provider keeps the `azure` name and
 * "Azure Translator" label so existing user settings keep working.
 *
 * It used to mint a bearer token from https://edge.microsoft.com/translate/auth
 * and call api-edge.cognitive.microsofttranslator.com. Microsoft retired that
 * token endpoint (it 404s for every request now, as part of the Edge
 * translation shutdown dated 2026-07-30), leaving the translate API reachable
 * but unusable. The auth material now comes from the www.bing.com/translator
 * page instead.
 *
 * Constraints:
 * - the token is short-lived (the page advertises one hour) and an expired one
 *   comes back as `statusCode: 205` inside an HTTP 200, so the body has to be
 *   inspected rather than just `response.ok`;
 * - bing.com sends no CORS headers, so a browser cannot call it at all. In the
 *   Tauri app the requests go out directly; in web builds they go through the
 *   same-origin proxy at /api/azure-translate.
 */
const PROXY_URL = '/api/azure-translate';
// Must not exceed the per-user concurrency the proxy allows, or the surplus
// requests come straight back as 429. Bing translates one text per request, so
// a page of paragraphs would otherwise fan out unbounded.
const MAX_CONCURRENT_REQUESTS = 3;
// Bing answers `statusCode: 400` above exactly 1000 UTF-16 code units — the
// cap counts code units, not bytes, so CJK and emoji measure the same as ASCII
// (verified empirically: 1000 passes, 1001 fails, for all three).
const MAX_CHARS_PER_REQUEST = 1000;
// Bing rejects a translate call that omits these telemetry identifiers with
// `statusCode: 400`, so they are forwarded alongside the token.
const buildTranslateQuery = (auth: BingAuthParams) =>
  new URLSearchParams({ isVertical: '1', IG: auth.ig, IID: auth.iid });

let cachedAuth: BingAuthParams | null = null;
// Concurrent lines must not each scrape the translator page, so the in-flight
// request is shared between callers.
let authPromise: Promise<BingAuthParams> | null = null;
let activeRequests = 0;
const requestQueue: Array<() => void> = [];

/**
 * Caps outbound requests across every concurrent `translate()` call — the
 * counter is module-level because the proxy budgets per user, not per call.
 * A task holds at most one slot at a time (auth is awaited before a translate
 * slot is taken), so this cannot deadlock.
 */
async function withRequestLimit<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
  } else {
    await new Promise<void>((resolve) => requestQueue.push(resolve));
  }
  try {
    return await task();
  } finally {
    const next = requestQueue.shift();
    // Hand the occupied slot straight over; leaving activeRequests untouched
    // makes the transfer atomic with respect to fresh callers.
    if (next) next();
    else activeRequests--;
  }
}

const requireWebToken = (token?: string | null) => {
  if (!token) {
    throw new Error('azure translate requires authentication in web builds');
  }
  return token;
};

async function fetchAuthParams(token?: string | null): Promise<BingAuthParams> {
  if (isTauriAppPlatform()) {
    const response = await withRequestLimit(() =>
      tauriFetch(BING_TRANSLATOR_URL, {
        method: 'GET',
        headers: { 'User-Agent': BING_REQUEST_HEADERS['User-Agent'] },
      }),
    );
    if (!response.ok) {
      throw new Error(`bing translate auth failed with status ${response.status}`);
    }
    return parseBingAuthParams(await response.text(), Date.now());
  }

  // The translator page is ~650KB of markup; the proxy parses it server-side
  // and returns just the auth material.
  const response = await withRequestLimit(() =>
    window.fetch(`${PROXY_URL}?endpoint=auth`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireWebToken(token)}` },
    }),
  );
  if (!response.ok) {
    throw new Error(`bing translate auth failed with status ${response.status}`);
  }
  const data = await response.json().catch(() => null);
  if (!isBingAuthParams(data)) {
    throw new Error('bing translate auth failed: malformed response');
  }
  return data;
}

async function getAuthParams(token?: string | null): Promise<BingAuthParams> {
  if (cachedAuth && cachedAuth.expiresAt > Date.now()) {
    return cachedAuth;
  }
  authPromise ??= fetchAuthParams(token)
    .then((auth) => {
      cachedAuth = auth;
      return auth;
    })
    .finally(() => {
      authPromise = null;
    });
  return authPromise;
}

async function translateChunk(
  chunk: string,
  fromLang: string,
  toLang: string,
  token?: string | null,
  retryAuth = true,
): Promise<string> {
  const auth = await getAuthParams(token);
  const body = new URLSearchParams({
    fromLang,
    text: chunk,
    to: toLang,
    token: auth.token,
    key: auth.key,
  });
  const query = buildTranslateQuery(auth);

  const response = await withRequestLimit(() =>
    isTauriAppPlatform()
      ? tauriFetch(`${BING_TRANSLATE_URL}?${query}`, {
          method: 'POST',
          headers: BING_REQUEST_HEADERS,
          body: body.toString(),
        })
      : window.fetch(`${PROXY_URL}?endpoint=translate&${query}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${requireWebToken(token)}`,
          },
          body: body.toString(),
        }),
  );

  if (!response.ok) {
    throw new Error(`bing translate failed with status ${response.status}`);
  }

  const data = await response.json().catch(() => null);
  // A rejected or expired token answers `statusCode: 205` with HTTP 200.
  const statusCode = typeof data?.statusCode === 'number' ? data.statusCode : null;
  if (statusCode !== null && statusCode !== 200) {
    if (statusCode === 205 && retryAuth) {
      // Drop the params this attempt used so the retry scrapes a fresh page,
      // without discarding params another call may have just refreshed.
      if (cachedAuth?.token === auth.token) cachedAuth = null;
      return translateChunk(chunk, fromLang, toLang, token, false);
    }
    throw new Error(`bing translate failed with status ${statusCode}`);
  }

  if (Array.isArray(data) && data.length > 0 && data[0]?.translations) {
    return data[0].translations[0]?.text || chunk;
  }
  return chunk;
}

export const azureProvider: TranslationProvider = {
  name: 'azure',
  label: _('Azure Translator'),
  get authRequired() {
    return !isTauriAppPlatform();
  },
  // Verified against the live endpoint: `The <b>quick</b> brown fox …` comes
  // back as `那只<b>敏捷</b>的棕色狐狸 …`, with the tag on the matching word
  // despite the reordering, with or without an explicit textType=html.
  preservesMarkup: true,
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
  ): Promise<string[]> => {
    if (!text.length) return [];
    if (!isTauriAppPlatform()) requireWebToken(token);

    // Bing only accepts its own language list — bare subtags plus script
    // variants like zh-Hans — and answers `statusCode: 400` for maximized
    // culture codes such as en-US or de-DE (the retired api-edge endpoint
    // tolerated them, so this must not go back to normalizeToFullLang).
    const normalized = sourceLang ? normalizeToShortLang(sourceLang) : '';
    // Bing spells auto-detection `auto-detect`; an empty or `auto` source
    // language means the same thing here.
    const fromLang =
      !normalized || normalized.toLowerCase() === 'auto' ? 'auto-detect' : normalized;
    const toLang = normalizeToShortLang(targetLang);

    const results: string[] = [];
    await Promise.all(
      text.map(async (line, index) => {
        if (!line?.trim().length) {
          results[index] = line;
          return;
        }
        // Bing caps a single request at 1000 characters, so longer paragraphs
        // go out as several chunks and are stitched back together.
        const translated = await Promise.all(
          splitTextIntoChunks(line, MAX_CHARS_PER_REQUEST).map((chunk) =>
            translateChunk(chunk, fromLang, toLang, token),
          ),
        );
        results[index] = translated.join('');
      }),
    );

    return results;
  },
};
