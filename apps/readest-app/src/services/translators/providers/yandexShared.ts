/**
 * Shared constants for the Yandex Translate web API: used both by the client
 * provider ('./yandex', which calls Yandex directly on Tauri) and by the
 * same-origin web proxy ('@/app/api/yandex-translate/route'). Keep this module
 * free of platform-specific imports so it loads in both bundles.
 */
export const YANDEX_ORIGIN = 'https://translate.yandex.ru';
export const YANDEX_SESSION_URL = `${YANDEX_ORIGIN}/props/api/v1.0/sessions`;
export const YANDEX_TRANSLATE_URL = 'https://translate.yandex.net/api/v1/tr.json/translate';
export const YANDEX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/148.0.0.0 YaBrowser/26.6.0.0 Safari/537.36';
export const YANDEX_REQUEST_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': YANDEX_USER_AGENT,
  Origin: YANDEX_ORIGIN,
  Referer: `${YANDEX_ORIGIN}/`,
};
