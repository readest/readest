import { describe, expect, it } from 'vitest';
import {
  LAN_SYNC_PAIRING_LINK,
  createLanSyncPairingPayload,
  parseLanSyncPairingPayload,
} from '@/services/lanSync/pairing';
import {
  buildLanSyncAuthHeaders,
  toLanStreamError,
} from '@/services/sync/providers/lan/LanSyncProvider';

describe('LAN Sync pairing payloads', () => {
  const status = { local_ips: ['192.168.1.5', '10.0.0.2'], port: 53430 };

  it('serializes anonymous endpoints as a direct Readest pairing link', () => {
    const raw = createLanSyncPairingPayload(status, '');
    const url = new URL(raw);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(LAN_SYNC_PAIRING_LINK);
    expect(url.searchParams.get('v')).toBe('1');
    expect(url.searchParams.getAll('host')).toEqual(status.local_ips);
    expect(url.searchParams.get('port')).toBe('53430');
    expect(url.searchParams.has('token')).toBe(false);
    expect(parseLanSyncPairingPayload(raw)).toEqual({
      v: 1,
      service: 'readest-lan-sync',
      hosts: status.local_ips,
      port: 53430,
    });
  });

  it('round-trips and URL-encodes a protected endpoint', () => {
    const raw = createLanSyncPairingPayload(status, '  secret token & value  ');
    expect(raw).toContain('readest://lan-sync/pair?');
    expect(parseLanSyncPairingPayload(raw)?.token).toBe('secret token & value');
  });

  it('continues to accept legacy JSON pairing QR codes', () => {
    const legacy = JSON.stringify({
      v: 1,
      service: 'readest-lan-sync',
      hosts: status.local_ips,
      port: 53430,
      token: 'legacy-token',
    });
    expect(parseLanSyncPairingPayload(legacy)).toEqual({
      v: 1,
      service: 'readest-lan-sync',
      hosts: status.local_ips,
      port: 53430,
      token: 'legacy-token',
    });
  });

  it('rejects unrelated or unsafe pairing links', () => {
    expect(parseLanSyncPairingPayload('readest://book/open?id=1')).toBeNull();
    expect(
      parseLanSyncPairingPayload('https://lan-sync/pair?v=1&host=192.168.1.5&port=53430'),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload('readest://lan-sync/pair?v=1&host=8.8.8.8&port=53430'),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload('readest://lan-sync/pair?v=1&host=192.168.1.255&port=53430'),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload('readest://lan-sync/pair?v=1&host=192.168.1.5&port=0'),
    ).toBeNull();
    expect(
      parseLanSyncPairingPayload(
        'readest://lan-sync/pair?v=1&host=192.168.1.5&port=53430&port=53431',
      ),
    ).toBeNull();
  });

  it('rejects non-Readest or unsafe legacy payloads', () => {
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

  it('only advertises private LAN addresses and removes duplicates', () => {
    const raw = createLanSyncPairingPayload(
      {
        local_ips: ['127.0.0.1', '8.8.8.8', '192.168.1.5', '192.168.1.5'],
        port: 53430,
      },
      '',
    );
    expect(new URL(raw).searchParams.getAll('host')).toEqual(['192.168.1.5']);
  });

  it('omits empty auth headers and trims protected tokens', () => {
    expect(buildLanSyncAuthHeaders('')).toEqual({});
    expect(buildLanSyncAuthHeaders('  secret-token  ')).toEqual({
      Authorization: 'Bearer secret-token',
    });
  });

  it('classifies native stream failures instead of allowing buffered fallback', () => {
    const networkError = toLanStreamError(new Error('connection reset'), 'download');
    expect(networkError.code).toBe('NETWORK');
    expect(networkError.message).toContain('download stream failed');

    const authError = toLanStreamError(
      new Error('request failed with status code 401: unauthorized'),
      'upload',
    );
    expect(authError.code).toBe('AUTH_FAILED');
    expect(authError.status).toBe(401);
  });
});
