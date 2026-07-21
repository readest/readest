import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';
import { YANDEX_REQUEST_HEADERS, YANDEX_SESSION_URL, YANDEX_TRANSLATE_URL } from './yandexShared';

/**
 * Direct client for the Yandex Translate web API — the same endpoints the
 * translate.yandex.ru frontend uses (protocol reverse-engineered by the
 * FOSWLY/translate project). No relay server or API key required.
 *
 * Constraints:
 * - the API rejects texts longer than ~650 chars with 413 "The text size
 *   exceeds the maximum" (verified empirically — the FOSWLY docs claiming
 *   10k are outdated), so longer texts are split into chunks;
 * - the session endpoint validates the Referer header. In the Tauri app we
 *   send it directly; in web builds the browser cannot spoof it cross-origin,
 *   so requests go through the same-origin proxy at /api/yandex-translate,
 *   which attaches the headers server-side.
 */
const MAX_CHARS_PER_REQUEST = 600;
const MAX_CONCURRENT_REQUESTS = 3;
// Reserve two requests for initial and refreshed sessions, and account for
// every translate chunk potentially retrying once with the refreshed SID.
const MAX_TRANSLATE_REQUESTS_PER_CALL = 29;
const TRANSPORT_TIMEOUT_MS = 15_000;
const PROXY_URL = '/api/yandex-translate';

interface YandexSession {
  id: string;
  expiresAt: number;
}

interface RequestWaiter {
  start: () => void;
  abort: () => void;
}

let cachedSession: YandexSession | null = null;
// Concurrent translate() calls must not race to create several sessions,
// so the in-flight creation is shared between callers.
let sessionPromise: Promise<string> | null = null;
let activeRequests = 0;
const requestQueue: RequestWaiter[] = [];

function releaseRequestSlot() {
  const waiter = requestQueue.shift();
  if (waiter) {
    // Transfer the occupied slot directly. Keeping activeRequests unchanged
    // makes the handoff atomic with respect to fresh callers.
    waiter.start();
  } else {
    activeRequests--;
  }
}

async function withRequestLimit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter: RequestWaiter = {
        start: () => {
          signal?.removeEventListener('abort', waiter.abort);
          resolve();
        },
        abort: () => {
          const index = requestQueue.indexOf(waiter);
          if (index >= 0) requestQueue.splice(index, 1);
          reject(signal?.reason);
        },
      };
      requestQueue.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
    });
  }

  try {
    signal?.throwIfAborted();
    return await task();
  } finally {
    releaseRequestSlot();
  }
}

const getRequestTarget = (endpoint: 'session' | 'translate') => {
  if (isTauriAppPlatform()) {
    return {
      fetchImpl: tauriFetch,
      url: endpoint === 'session' ? YANDEX_SESSION_URL : YANDEX_TRANSLATE_URL,
      headers: YANDEX_REQUEST_HEADERS,
      direct: true,
    };
  }
  return {
    fetchImpl: window.fetch.bind(window),
    url: `${PROXY_URL}?endpoint=${endpoint}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    direct: false,
  };
};

const withParams = (base: string, params: URLSearchParams) =>
  `${base}${base.includes('?') ? '&' : '?'}${params}`;

const requestSignal = (direct: boolean, signal?: AbortSignal) => {
  if (!direct) return signal;
  const timeout = AbortSignal.timeout(TRANSPORT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

// yu — random Yandex UID, yum — Metrika timestamp in microseconds
const genYandexUID = () => BigInt(Math.floor(Math.random() * 1e19)).toString();
const genYandexMetrikaUID = () => (Date.now() * 1e6).toString();

const baseParams = () => ({
  srv: 'tr-text',
  yu: genYandexUID(),
  yum: genYandexMetrikaUID(),
});

async function createSession(): Promise<string> {
  const { fetchImpl, url, headers, direct } = getRequestTarget('session');
  const params = new URLSearchParams(baseParams());
  const signal = requestSignal(direct);
  const response = await withRequestLimit(
    () =>
      fetchImpl(withParams(url, params), {
        method: 'POST',
        headers,
        signal,
      }),
    signal,
  );
  if (!response.ok) {
    throw new Error(`yandex session request failed with status ${response.status}`);
  }
  const data = await response.json();
  const session = data?.session;
  if (
    typeof session?.id !== 'string' ||
    !session.id ||
    !Number.isFinite(session.creationTimestamp) ||
    session.creationTimestamp <= 0 ||
    !Number.isFinite(session.maxAge) ||
    session.maxAge <= 0
  ) {
    throw new Error('yandex session request failed: malformed response');
  }
  cachedSession = {
    id: session.id,
    expiresAt: (session.creationTimestamp + session.maxAge) * 1000,
  };
  return session.id;
}

async function getSession(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession.id;
  }
  sessionPromise ??= createSession().finally(() => {
    sessionPromise = null;
  });
  if (!signal) return sessionPromise;

  return new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    sessionPromise!.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

/**
 * Splits a long text into chunks of at most `maxLength` UTF-16 code units,
 * breaking on sentence ends, newlines or spaces whenever possible without
 * splitting a Unicode grapheme cluster.
 */
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const boundaries = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ index }) => index,
  );
  boundaries.push(text.length);

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    for (const boundary of boundaries) {
      if (boundary <= start) continue;
      if (boundary - start > maxLength) break;
      end = boundary;
    }
    if (end === start) {
      throw new Error('yandex translate cannot fit a grapheme cluster within the request limit');
    }

    const window = text.slice(start, end);
    let cut = end;
    const sentenceEnd = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
    );
    if (sentenceEnd > maxLength / 2) {
      cut = start + sentenceEnd + 1;
    } else {
      const space = window.lastIndexOf(' ');
      if (space > maxLength / 2) cut = start + space + 1;
    }
    chunks.push(text.slice(start, cut));
    start = cut;
  }
  return chunks;
}

async function translateChunk(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
  retrySession = true,
): Promise<string> {
  signal?.throwIfAborted();
  const sid = await getSession(signal);
  const params = new URLSearchParams({
    ...baseParams(),
    sid: `${sid}-5-0`,
    source_lang: sourceLang,
    target_lang: targetLang,
    reason: 'paste',
    format: 'text',
    strategy: '0',
    disable_cache: 'false',
    ajax: '1',
  });
  const body = new URLSearchParams([
    ['options', '0'],
    ['text', text],
  ]);

  const { fetchImpl, url, headers, direct } = getRequestTarget('translate');
  const transportSignal = requestSignal(direct, signal);
  const response = await withRequestLimit(
    () =>
      fetchImpl(withParams(url, params), {
        method: 'POST',
        headers,
        body: body.toString(),
        signal: transportSignal,
      }),
    transportSignal,
  );
  const data = await response.json().catch(() => null);
  if (response.ok && !data) {
    throw new Error('yandex translate failed: malformed response');
  }
  const errorCode = typeof data?.code === 'number' ? data.code : null;
  if (!response.ok || errorCode !== 200 || data?.message) {
    // Proxy transport errors use { error } without a Yandex `code`; they must
    // not invalidate a healthy SID or trigger a futile retry.
    const sessionInvalid = errorCode === 401 || errorCode === 403;
    if (sessionInvalid && cachedSession?.id === sid) cachedSession = null;
    if (sessionInvalid && retrySession) {
      return translateChunk(text, sourceLang, targetLang, signal, false);
    }
    throw new Error(
      `yandex translate failed with status ${response.status}: ${data?.message ?? data?.error ?? 'unknown error'}`,
    );
  }
  if (!Array.isArray(data.text) || !data.text.every((item: unknown) => typeof item === 'string')) {
    throw new Error('yandex translate failed: malformed response');
  }
  return data.text.join('');
}

export const yandexProvider: TranslationProvider = {
  name: 'yandex',
  label: _('Yandex Translate'),
  authRequired: false,
  translate: async (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    _useCache?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!texts.length) return [];

    const normalizeLang = (lang: string) => {
      const normalized = normalizeToShortLang(lang).toLowerCase();
      return normalized === 'zh' || normalized.startsWith('zh-') ? 'zh' : normalized;
    };
    const source_lang = sourceLang === 'AUTO' ? 'auto' : normalizeLang(sourceLang);
    const target_lang = normalizeLang(targetLang);
    const chunkedTexts = texts.map((text) => splitTextIntoChunks(text, MAX_CHARS_PER_REQUEST));
    const chunkCount = chunkedTexts.reduce((total, chunks) => total + chunks.length, 0);
    if (chunkCount > MAX_TRANSLATE_REQUESTS_PER_CALL) {
      throw new Error(
        `yandex translate request requires ${chunkCount} chunks; maximum is ${MAX_TRANSLATE_REQUESTS_PER_CALL}`,
      );
    }

    const results = new Array<string>(texts.length);
    const jobs = chunkedTexts.flatMap((chunks, textIndex) =>
      chunks.map((chunk, chunkIndex) => ({ chunk, chunkIndex, textIndex })),
    );
    const translatedChunks = chunkedTexts.map((chunks) => new Array<string>(chunks.length));
    let nextJob = 0;
    const worker = async () => {
      while (nextJob < jobs.length) {
        signal?.throwIfAborted();
        const job = jobs[nextJob++]!;
        translatedChunks[job.textIndex]![job.chunkIndex] = await translateChunk(
          job.chunk,
          source_lang,
          target_lang,
          signal,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, jobs.length) }, () => worker()),
    );
    translatedChunks.forEach((chunks, index) => {
      results[index] = chunks.join('');
    });
    return results;
  },
};
