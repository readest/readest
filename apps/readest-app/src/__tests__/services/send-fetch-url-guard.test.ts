import { describe, expect, test } from 'vitest';
import { isBlockedHost } from '@/pages/api/send/fetch-url';

// `isBlockedHost` receives the host as the WHATWG URL parser serializes it, so
// these helpers mirror that normalization for the test inputs.
const hostOf = (url: string) => new URL(url).hostname;

describe('isBlockedHost — internal names', () => {
  test('blocks localhost and internal suffixes', () => {
    for (const h of ['localhost', 'foo.localhost', 'db.internal', 'host.local', 'box.lan']) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });

  test('blocks bare single-label hostnames', () => {
    expect(isBlockedHost('intranet')).toBe(true);
    expect(isBlockedHost('metadata')).toBe(true);
  });

  test('allows normal public hostnames', () => {
    for (const h of ['example.com', 'www.readest.com', 'sub.domain.co.uk']) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
});

describe('isBlockedHost — IPv4 (incl. encoded forms normalized by URL)', () => {
  test('blocks loopback / private / link-local / CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '100.64.0.1',
    ]) {
      expect(isBlockedHost(ip)).toBe(true);
    }
  });

  test('blocks decimal / hex / octal IPv4 once URL-normalized', () => {
    expect(isBlockedHost(hostOf('http://2130706433/'))).toBe(true); // 127.0.0.1
    expect(isBlockedHost(hostOf('http://0x7f000001/'))).toBe(true); // 127.0.0.1
  });

  test('allows public IPv4', () => {
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('1.1.1.1')).toBe(false);
  });
});

describe('isBlockedHost — IPv6', () => {
  test('blocks loopback / unique-local / link-local', () => {
    for (const ip of ['[::1]', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1']) {
      expect(isBlockedHost(ip)).toBe(true);
    }
  });

  test('blocks IPv4-mapped IPv6 pointing at private space', () => {
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedHost('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedHost('::ffff:7f00:1')).toBe(true); // 127.0.0.1 in hex
  });

  test('allows IPv4-mapped IPv6 pointing at public space', () => {
    expect(isBlockedHost('::ffff:8.8.8.8')).toBe(false);
  });
});
