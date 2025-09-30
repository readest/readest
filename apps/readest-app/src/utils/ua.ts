import { AppService } from '@/types/system';

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
    // Linux WebView
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

export const parseWebViewVersion = (appService: AppService | null): number => {
  const webViewInfo = parseWebViewInfo(appService);
  const versionMatch = webViewInfo.match(/([0-9]+)\./);
  return versionMatch ? parseFloat(versionMatch[1]!) : 0;
};
