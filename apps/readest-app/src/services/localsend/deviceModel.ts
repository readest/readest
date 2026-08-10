import type { OsPlatform } from '@/types/system';

/**
 * OS display name shown as this device's tag by other LocalSend clients
 * (the chip beside the alias). `isTablet` splits iOS into iPad/iPhone —
 * callers derive it from the screen, since Tauri reports both as `ios`.
 */
export function localSendDeviceModel(os: OsPlatform, isTablet: boolean): string {
  switch (os) {
    case 'android':
      return 'Android';
    case 'ios':
      return isTablet ? 'iPadOS' : 'iOS';
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'Readest';
  }
}
