import type { LanSyncStatus } from './lifecycle';

export const LAN_SYNC_PAIRING_SERVICE = 'readest-lan-sync';
export const LAN_SYNC_PAIRING_VERSION = 1 as const;

export interface LanSyncPairingPayload {
  v: typeof LAN_SYNC_PAIRING_VERSION;
  service: typeof LAN_SYNC_PAIRING_SERVICE;
  hosts: string[];
  port: number;
  token: string;
}

const isIpv4 = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
};

const isValidToken = (value: string): boolean =>
  value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

/** Serialize the active server's LAN endpoint for a QR code. */
export const createLanSyncPairingPayload = (
  status: Pick<LanSyncStatus, 'local_ips' | 'port'>,
  token: string,
): string => {
  const hosts = status.local_ips.filter(isIpv4);
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
    if (
      record.v !== LAN_SYNC_PAIRING_VERSION ||
      record.service !== LAN_SYNC_PAIRING_SERVICE ||
      !Array.isArray(record.hosts)
    ) {
      return null;
    }
    const hosts = record.hosts.filter(isIpv4);
    if (!hosts.length || hosts.length !== record.hosts.length) return null;
    const port = record.port;
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return null;
    const token = typeof record.token === 'string' ? record.token.trim() : '';
    if (!isValidToken(token)) return null;
    return {
      v: LAN_SYNC_PAIRING_VERSION,
      service: LAN_SYNC_PAIRING_SERVICE,
      hosts,
      port: port as number,
      token,
    };
  } catch {
    return null;
  }
};
