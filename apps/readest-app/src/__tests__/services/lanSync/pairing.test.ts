import { describe, expect, it } from 'vitest';
import {
  createLanSyncPairingPayload,
  parseLanSyncPairingPayload,
} from '@/services/lanSync/pairing';

describe('LAN Sync pairing payloads', () => {
  const status = { local_ips: ['192.168.1.5', '10.0.0.2'], port: 53430 };

  it('serializes anonymous endpoints without a token', () => {
    const raw = createLanSyncPairingPayload(status, '');
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      service: 'readest-lan-sync',
      hosts: status.local_ips,
      port: 53430,
    });
    expect(parseLanSyncPairingPayload(raw)).toEqual({
      v: 1,
      service: 'readest-lan-sync',
      hosts: status.local_ips,
      port: 53430,
      token: '',
    });
  });

  it('round-trips a protected endpoint', () => {
    const raw = createLanSyncPairingPayload(status, '  secret-token  ');
    expect(parseLanSyncPairingPayload(raw)?.token).toBe('secret-token');
  });

  it('rejects non-Readest or unsafe payloads', () => {
    expect(parseLanSyncPairingPayload('{"service":"other","v":1}')).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        JSON.stringify({
          v: 1,
          service: 'readest-lan-sync',
          hosts: ['127.0.0.1/evil'],
          port: 53430,
        }),
      ),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        JSON.stringify({ v: 1, service: 'readest-lan-sync', hosts: ['192.168.1.5'], port: 0 }),
      ),
    ).toBeNull();
  });
});
