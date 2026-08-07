/**
 * Shared constants and parsing for the Bing Translator web API: used both by
 * the client provider ('./azure', which calls Bing directly on Tauri) and by
 * the same-origin web proxy ('@/app/api/azure-translate/route'). Keep this
 * module free of platform-specific imports so it loads in both bundles.
 *
 * Microsoft retired the tokenless endpoint the provider used to rely on
 * (https://edge.microsoft.com/translate/auth now 404s for every request, as
 * part of the Edge translation shutdown dated 2026-07-30), so the auth token
 * is now taken from the www.bing.com/translator page the same way the Bing
 * Translator frontend does.
 */
export const BING_ORIGIN = 'https://www.bing.com';
export const BING_TRANSLATOR_URL = `${BING_ORIGIN}/translator`;
export const BING_TRANSLATE_URL = `${BING_ORIGIN}/ttranslatev3`;
export const BING_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
export const BING_REQUEST_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': BING_USER_AGENT,
  Referer: BING_TRANSLATOR_URL,
};

/**
 * `key` and `token` authenticate the translate call; `ig` and `iid` are
 * telemetry identifiers that the endpoint nonetheless rejects requests
 * without (omitting them answers `statusCode: 400`).
 */
export interface BingAuthParams {
  ig: string;
  iid: string;
  key: string;
  token: string;
  expiresAt: number;
}

// The page advertises a one-hour lifetime; retire the token slightly early so
// a request already in flight cannot land just after it expires.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export const isBingAuthParams = (value: unknown): value is BingAuthParams => {
  const params = value as Partial<BingAuthParams> | null;
  return (
    !!params &&
    typeof params.ig === 'string' &&
    typeof params.iid === 'string' &&
    typeof params.key === 'string' &&
    typeof params.token === 'string' &&
    typeof params.expiresAt === 'number'
  );
};

/**
 * Extracts the auth material the translate endpoint requires from the
 * translator page markup. `now` is injected so the proxy can stamp the expiry
 * against its own clock rather than trusting the page's timestamp, which
 * would drift on a client whose clock is skewed.
 */
export const parseBingAuthParams = (html: string, now: number): BingAuthParams => {
  // params_AbusePreventionHelper = [<key>,"<token>",<ttlMs>]
  const abusePrevention = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/,
  );
  const ig = html.match(/IG\s*:\s*"([A-Fa-f0-9]+)"/);
  const iid = html.match(/data-iid\s*=\s*"([^"]+)"/);

  if (!abusePrevention || !ig || !iid) {
    throw new Error('bing translate auth failed: could not parse the translator page');
  }

  return {
    ig: ig[1]!,
    iid: iid[1]!,
    key: abusePrevention[1]!,
    token: abusePrevention[2]!,
    expiresAt: now + Math.max(Number(abusePrevention[3]) - EXPIRY_SAFETY_MARGIN_MS, 0),
  };
};
