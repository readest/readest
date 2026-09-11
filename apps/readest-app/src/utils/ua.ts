import { AppService } from '@/types/system';

/**
 * Whether local files must be read through the `rangefile` query-range scheme
 * instead of the asset protocol with a `Range` header. Chromium re-applies a
 * `Range` header's offset to the body of an intercepted custom-protocol
 * response (Chromium 40739128), so every non-zero-start read fails: that is the
 * Android WebView and, on Linux, the CEF runtime, which is the only Linux
 * webview that carries a `Chrome/` token (WebKitGTK never does).
 */
export const needsQueryRangeReads = (osType: string, userAgent: string) =>
  osType === 'android' || (osType === 'linux' && isLinuxCefRuntime(userAgent));

/**
 * The Linux CEF (Chromium) build. WebKitGTK never sends a `Chrome/` token and
 * Android identifies itself in the platform part, so this only matches the
 * desktop Linux Chromium runtime.
 */
export const isLinuxCefRuntime = (userAgent: string) =>
  /\bLinux\b/.test(userAgent) && !/\bAndroid\b/.test(userAgent) && /\bChrome\//.test(userAgent);

export const parseWebViewInfo = (appService: AppService | null): string => {
  const ua = navigator.userAgent;

  if (appService?.isAndroidApp) {
    // Android WebView
    const chromeMatch = ua.match(/Chrome\/([0-9.]+)/);
    return chromeMatch ? `WebView ${chromeMatch[1]}` : 'Android WebView';
  } else if (appService?.isIOSApp) {
    // iOS WebView
    const webkitMatch = ua.match(/AppleWebKit\/([0-9.]+)/);
    return webkitMatch ? `WebView ${webkitMatch[1]}` : 'iOS WebView';
  } else if (appService?.isMacOSApp) {
    // macOS WebView
    const webkitMatch = ua.match(/AppleWebKit\/([0-9.]+)/);
    return webkitMatch ? `WebView ${webkitMatch[1]}` : 'macOS WebView';
  } else if (appService?.appPlatform === 'tauri' && appService?.osPlatform === 'windows') {
    // Windows WebView2
    const match = ua.match(/Edg\/([0-9.]+)/);
    return match ? `Edge ${match[1]}` : 'Edge WebView2';
  } else if (appService?.appPlatform === 'tauri' && appService?.osPlatform === 'linux') {
    // Linux: the CEF build reports Chromium (its user agent is reduced to the
    // major version, e.g. Chrome/151.0.0.0); otherwise WebKitGTK.
    const chromeMatch = ua.match(/Chrome\/([0-9.]+)/);
    if (chromeMatch) return `Chromium ${chromeMatch[1]}`;
    const match = ua.match(/AppleWebKit\/([0-9.]+)/);
    return match ? `WebView ${match[1]}` : 'Linux WebView';
  } else if (ua.includes('CriOS') && ua.includes('Mobile/') && ua.includes('Safari')) {
    // iOS Chrome WebView
    const match = ua.match(/CriOS\/([0-9.]+)/);
    return match ? `Chrome ${match[1]}` : 'iOS Chrome';
  } else if (ua.includes('FxiOS') && ua.includes('Mobile/') && ua.includes('Safari')) {
    // iOS Firefox WebView
    const match = ua.match(/FxiOS\/([0-9.]+)/);
    return match ? `Firefox ${match[1]}` : 'iOS Firefox';
  } else if (ua.includes('Chrome') && ua.includes('AppleWebKit') && ua.includes('Macintosh')) {
    // macOS Chrome
    const match = ua.match(/Chrome\/([0-9.]+)/);
    return match ? `Chrome ${match[1]}` : 'macOS Chrome';
  } else if (ua.includes('Safari') && ua.includes('AppleWebKit') && ua.includes('Macintosh')) {
    // macOS Safari
    const match = ua.match(/Safari\/([0-9.]+)/);
    return match ? `Safari ${match[1]}` : 'macOS Safari';
  } else if (ua.includes('Edg/')) {
    // Microsoft Edge
    const match = ua.match(/Edg\/([0-9.]+)/);
    return match ? `Edge ${match[1]}` : 'Edge WebView';
  } else if (ua.includes('Firefox/')) {
    // Firefox
    const match = ua.match(/Firefox\/([0-9.]+)/);
    return match ? `Firefox ${match[1]}` : 'Firefox Gecko';
  } else if (ua.includes('Chrome/') && !ua.includes('Chromium')) {
    // Chrome
    const match = ua.match(/Chrome\/([0-9.]+)/);
    return match ? `Chrome ${match[1]}` : 'Chrome';
  } else if (ua.includes('Chromium/')) {
    // Chromium
    const match = ua.match(/Chromium\/([0-9.]+)/);
    return match ? `Chromium ${match[1]}` : 'Chromium';
  } else if (ua.includes('MSIE ')) {
    // Internet Explorer
    const match = ua.match(/MSIE ([0-9.]+)/);
    return match ? `IE ${match[1]}` : 'Internet Explorer';
  } else {
    return 'Unknown';
  }
};

/**
 * The brand a Chromium engine reports in User-Agent Client Hints'
 * `fullVersionList`, keyed by the same engine labels `parseWebViewInfo`
 * emits. WebKit engines have no Client Hints (their UA already carries the
 * real version), so they are absent here.
 */
/**
 * Whether this Chromium engine reports its real build in User-Agent Client
 * Hints, and which `fullVersionList` brand carries it. WebKit engines have no
 * Client Hints (their UA already carries the real version), so they are
 * absent. The UA token decides the runtime flavor, the `OS` part decides
 * desktop-vs-mobile only where the brands differ (desktop Edge vs WebView2
 * share the `Microsoft Edge` brand; Android WebView reports both a
 * `Android WebView` and a `Google Chrome` entry).
 */
const clientHintsBrandFor = (ua: string): RegExp | null => {
  if (!/Chrome\/|Edg\//.test(ua)) return null; // WebKit engines: no Client Hints
  if (/Edg\//.test(ua)) return /Microsoft Edge/i;
  return /(Chromium|Google Chrome|Android WebView)/i;
};

/**
 * The real full build number (e.g. `138.0.3351.62`) behind a UA-reduced
 * version string. Chromium freezes the minor/build/patch tokens in the UA
 * itself (`Edg/138.0.0.0`), so on WebView2/Android WebView/Chrome the parsed
 * version is incomplete; the full build is only in the high-entropy
 * `fullVersionList` Client Hint. Returns null when the engine has no Client
 * Hints entry or the API is unavailable (WebKit, older WebViews).
 */
export const getWebViewFullVersion = async (): Promise<string | null> => {
  const brandPattern = clientHintsBrandFor(navigator.userAgent);
  if (!brandPattern) return null;
  try {
    const uaData = (
      navigator as unknown as {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{
            fullVersionList?: { brand: string; version: string }[];
          }>;
        };
      }
    ).userAgentData;
    const getHighEntropyValues = uaData?.getHighEntropyValues;
    if (typeof getHighEntropyValues !== 'function') return null;
    const { fullVersionList } = await getHighEntropyValues.call(uaData, ['fullVersionList']);
    return fullVersionList?.find((entry) => brandPattern.test(entry.brand))?.version ?? null;
  } catch {
    return null;
  }
};

/**
 * `parseWebViewInfo` with the UA-reduced version upgraded to the real build
 * via Client Hints when available. Async only because of that round-trip;
 * falls back to the sync label verbatim (WebKit engines, older WebViews).
 */
export const parseWebViewInfoAsync = async (appService: AppService | null): Promise<string> => {
  const info = parseWebViewInfo(appService);
  const fullVersion = await getWebViewFullVersion();
  if (!fullVersion) return info;
  return info.replace(/\s+[0-9]+(?:\.[0-9]+)*$/, ` ${fullVersion}`);
};

export const parseWebViewVersion = (appService: AppService | null): number => {
  const webViewInfo = parseWebViewInfo(appService);
  const versionMatch = webViewInfo.match(/([0-9]+)\./);
  return versionMatch ? parseFloat(versionMatch[1]!) : 0;
};

export const isSafariBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
};
