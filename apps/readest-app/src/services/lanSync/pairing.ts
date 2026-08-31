import type { LanSyncStatus } from './lifecycle';

export const LAN_SYNC_PAIRING_SERVICE = 'readest-lan-sync';
export const LAN_SYNC_PAIRING_VERSION = 1 as const;
export const LAN_SYNC_PROTOCOL = 'readest-lan-sync-1' as const;

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

/** Serialize the active server's LAN endpoint for a QR code. */
export const createLanSyncPairingPayload = (
  status: Pick<LanSyncStatus, 'local_ips' | 'port'>,
  token: string,
): string => {
  const hosts = status.local_ips.filter(isLanIpv4);
  if (!hosts.length || !Number.isInteger(status.port) || status.port < 1 || status.port > 65535) {
    return '';
  }
  const normalizedToken = token.trim();
  if (!isValidToken(normalizedToken)) return '';
  return JSON.stringify({
    v: LAN_SYNC_PAIRING_VERSION,
    service: LAN_SYNC_PAIRING_SERVICE,
    hosts,
    port: status.port,
    ...(normalizedToken ? { token: normalizedToken } : {}),
  });
};

/** Parse and validate only Readest LAN pairing payloads. */
export const parseLanSyncPairingPayload = (raw: string): LanSyncPairingPayload | null => {
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
    const hosts = rawHosts.filter(isLanIpv4);
    if (!hosts.length || hosts.length !== rawHosts.length) return null;
    const port = record['port'];
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return null;
    const rawToken = record['token'];
    if (rawToken !== undefined && typeof rawToken !== 'string') return null;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!isValidToken(token)) return null;
    return {
      v: LAN_SYNC_PAIRING_VERSION,
      service: LAN_SYNC_PAIRING_SERVICE,
      hosts,
      port: port as number,
      ...(token ? { token } : {}),
    };
  } catch {
    return null;
  }
};
