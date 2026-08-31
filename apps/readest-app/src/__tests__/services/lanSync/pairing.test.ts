import { describe, expect, it } from 'vitest';
import {
  createLanSyncPairingPayload,
  parseLanSyncPairingPayload,
} from '@/services/lanSync/pairing';
import { buildLanSyncAuthHeaders } from '@/services/sync/providers/lan/LanSyncProvider';

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
          hosts: ['127.0.0.1'],
          port: 53430,
        }),
      ),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        JSON.stringify({
          v: 1,
          service: 'readest-lan-sync',
          hosts: ['8.8.8.8'],
          port: 53430,
        }),
      ),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        JSON.stringify({
          v: 1,
          service: 'readest-lan-sync',
          hosts: ['192.168.1.255'],
          port: 53430,
        }),
      ),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        JSON.stringify({
          v: 1,
          service: 'readest-lan-sync',
          hosts: ['192.168.001.5'],
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

  it('only advertises private LAN addresses', () => {
    expect(
      JSON.parse(
        createLanSyncPairingPayload(
          { local_ips: ['127.0.0.1', '8.8.8.8', '192.168.1.5'], port: 53430 },
          '',
        ),
      ).hosts,
    ).toEqual(['192.168.1.5']);
  });

  it('omits empty auth headers and trims protected tokens', () => {
    expect(buildLanSyncAuthHeaders('')).toEqual({});
    expect(buildLanSyncAuthHeaders('  secret-token  ')).toEqual({
      Authorization: 'Bearer secret-token',
    });
  });
});
