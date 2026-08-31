import type { LanSyncStatus } from './lifecycle';

export const LAN_SYNC_PAIRING_SERVICE = 'readest-lan-sync';
export const LAN_SYNC_PAIRING_VERSION = 1 as const;
export const LAN_SYNC_PROTOCOL = 'readest-lan-sync-1' as const;
export const LAN_SYNC_PAIRING_LINK = 'readest://lan-sync/pair';

export interface LanSyncPairingPayload {
  v: typeof LAN_SYNC_PAIRING_VERSION;
  service: typeof LAN_SYNC_PAIRING_SERVICE;
  hosts: string[];
  port: number;
  token?: string;
}

const isIpv4 = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  );
};

const isLanIpv4 = (value: unknown): value is string => {
  if (!isIpv4(value)) return false;
  const [a, b, , d] = value.split('.').map(Number);
  if (a === undefined || b === undefined || d === undefined || d === 255) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
};

const isValidToken = (value: string): boolean =>
  value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

const normalizePairing = (
  hosts: unknown[],
  port: unknown,
  rawToken?: unknown,
): LanSyncPairingPayload | null => {
  const validHosts = hosts.filter(isLanIpv4);
  if (!validHosts.length || validHosts.length !== hosts.length) return null;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return null;
  if (rawToken !== undefined && typeof rawToken !== 'string') return null;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!isValidToken(token)) return null;
  return {
    v: LAN_SYNC_PAIRING_VERSION,
    service: LAN_SYNC_PAIRING_SERVICE,
    hosts: validHosts,
    port: port as number,
    ...(token ? { token } : {}),
  };
};

/** Serialize the active server as a Readest deep link suitable for a QR code. */
export const createLanSyncPairingPayload = (
  status: Pick<LanSyncStatus, 'local_ips' | 'port'>,
  token: string,
): string => {
  const hosts = [...new Set(status.local_ips.filter(isLanIpv4))];
  if (!hosts.length || !Number.isInteger(status.port) || status.port < 1 || status.port > 65535) {
    return '';
  }
  const normalizedToken = token.trim();
  if (!isValidToken(normalizedToken)) return '';

  const url = new URL(LAN_SYNC_PAIRING_LINK);
  url.searchParams.set('v', String(LAN_SYNC_PAIRING_VERSION));
  for (const host of hosts) url.searchParams.append('host', host);
  url.searchParams.set('port', String(status.port));
  if (normalizedToken) url.searchParams.set('token', normalizedToken);
  return url.toString();
};

const parseLanSyncPairingLink = (raw: string): LanSyncPairingPayload | null => {
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'readest:' ||
      url.hostname !== 'lan-sync' ||
      url.pathname !== '/pair' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null;
    }

    const versions = url.searchParams.getAll('v');
    const ports = url.searchParams.getAll('port');
    const tokens = url.searchParams.getAll('token');
    if (
      versions.length !== 1 ||
      versions[0] !== String(LAN_SYNC_PAIRING_VERSION) ||
      ports.length !== 1 ||
      !/^\d+$/.test(ports[0] ?? '') ||
      tokens.length > 1
    ) {
      return null;
    }

    return normalizePairing(
      url.searchParams.getAll('host'),
      Number(ports[0]),
      tokens.length ? tokens[0] : undefined,
    );
  } catch {
    return null;
  }
};

const parseLegacyLanSyncPairingPayload = (raw: string): LanSyncPairingPayload | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const rawHosts = record['hosts'];
    if (
      record['v'] !== LAN_SYNC_PAIRING_VERSION ||
      record['service'] !== LAN_SYNC_PAIRING_SERVICE ||
      !Array.isArray(rawHosts)
    ) {
      return null;
    }
    return normalizePairing(rawHosts, record['port'], record['token']);
  } catch {
    return null;
  }
};

/** Parse a Readest LAN pairing link while remaining compatible with legacy JSON QR codes. */
export const parseLanSyncPairingPayload = (raw: string): LanSyncPairingPayload | null =>
  parseLanSyncPairingLink(raw) ?? parseLegacyLanSyncPairingPayload(raw);
