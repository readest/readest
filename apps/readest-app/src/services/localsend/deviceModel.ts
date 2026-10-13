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

/**
 * The single "#<n>" tag for a device with several addresses.
 *
 * A device has one tag, so a user can read it out and match it against the one
 * a peer shows. Multi-homed hosts break that if every address is listed: an
 * iPhone on Wi-Fi and plugged into a Mac has a Wi-Fi address and an
 * autoconfigured link-local one for the USB link, and used to advertise both.
 * Pick the address a peer is most likely to have reached, deterministically:
 * routable before link-local, then the lowest. The Rust side ranks a peer's
 * confirmed channels by the same rule, so the two displays agree.
 */
export function preferredIpTag(hosts: string[]): string | null {
  const ranked = hosts
    .filter((host) => ipTag(host) !== null)
    .map((host) => host.split('.').map(Number))
    .sort((a, b) => {
      const linkLocal = (o: number[]) => (o[0] === 169 && o[1] === 254 ? 1 : 0);
      return (
        linkLocal(a) - linkLocal(b) ||
        a[0]! - b[0]! ||
        a[1]! - b[1]! ||
        a[2]! - b[2]! ||
        a[3]! - b[3]!
      );
    });
  const best = ranked[0];
  return best ? `#${best[3]}` : null;
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
