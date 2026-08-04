import { describe, expect, it } from 'vitest';
import { isValidBookOrbitEndpoint } from '@/pages/api/bookorbit';
import { isLanAddress } from '@/utils/network';

/**
 * The BookOrbit proxy shares the kosync proxy's SSRF posture: private/internal
 * server addresses are rejected via isLanAddress (covered in kosync-ssrf.test.ts)
 * and the endpoint list is anchored so no other server path is reachable.
 */
describe('bookorbit proxy endpoint whitelist', () => {
  it('accepts exactly the plugin API endpoints', () => {
    for (const endpoint of [
      '/users/auth',
      '/plugin/version',
      '/plugin/match-check',
      '/plugin/annotations/exchange',
      '/plugin/annotations/exchange-ack',
      '/plugin/bookmarks/exchange',
      '/plugin/bookmarks/exchange-ack',
      '/plugin/page-stats',
      '/plugin/book-states',
    ]) {
      expect(isValidBookOrbitEndpoint(endpoint)).toBe(true);
    }
  });

  it('rejects traversal, registration, and unanchored variants', () => {
    for (const endpoint of [
      '/users/create',
      '/plugin/version/../../../admin',
      '/plugin/versionx',
      'plugin/version',
      '/plugin/package',
      '/plugin/catalog/root',
      '/syncs/progress',
      '',
    ]) {
      expect(isValidBookOrbitEndpoint(endpoint)).toBe(false);
    }
  });
});

describe('bookorbit proxy SSRF address checks', () => {
  it('still classifies private/internal addresses as LAN (rejected by the handler)', () => {
    expect(isLanAddress('http://169.254.169.254')).toBe(true);
    expect(isLanAddress('http://[::1]:3000')).toBe(true);
    expect(isLanAddress('http://10.0.0.5')).toBe(true);
    expect(isLanAddress('https://books.example.com')).toBe(false);
  });
});
