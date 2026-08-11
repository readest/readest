import type { OsPlatform } from '@/types/system';

/**
 * OS display name shown as this device's tag by other LocalSend clients
 * (the chip beside the alias). `isTablet` splits iOS into iPad/iPhone —
 * callers derive it from the screen, since Tauri reports both as `ios`.
 */
/**
 * Short tag identifying a device on the LAN by the last octet of its IPv4
 * address, e.g. `#120` for 192.168.2.120. Users read it out ("send to #120
 * macOS") so peers know which list entry to pick when aliases collide.
 * Returns null for non-IPv4 hosts.
 */
export function ipTag(host: string): string | null {
  const octets = host.split('.');
  if (octets.length !== 4) return null;
  if (!octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return null;
  return `#${Number(octets[3])}`;
}

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
