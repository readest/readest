import { describe, it, expect } from 'vitest';
import { isLanAddress } from '@/utils/network';

describe('isLanAddress', () => {
  // -----------------------------------------------------------------------
  // Localhost
  // -----------------------------------------------------------------------
  describe('localhost', () => {
    it('returns true for localhost', () => {
      expect(isLanAddress('http://localhost')).toBe(true);
      expect(isLanAddress('http://localhost:8080')).toBe(true);
      expect(isLanAddress('https://localhost/path')).toBe(true);
    });

    it('returns true for 127.0.0.1', () => {
      expect(isLanAddress('http://127.0.0.1')).toBe(true);
      expect(isLanAddress('http://127.0.0.1:3000')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Private IPv4 ranges
  // -----------------------------------------------------------------------
  describe('private IPv4 ranges', () => {
    it('returns true for 10.x.x.x (Class A)', () => {
      expect(isLanAddress('http://10.0.0.1')).toBe(true);
      expect(isLanAddress('http://10.255.255.255')).toBe(true);
      expect(isLanAddress('http://10.1.2.3:8080')).toBe(true);
    });

    it('returns true for 172.16.x.x - 172.31.x.x (Class B)', () => {
      expect(isLanAddress('http://172.16.0.1')).toBe(true);
      expect(isLanAddress('http://172.31.255.255')).toBe(true);
      expect(isLanAddress('http://172.20.1.1')).toBe(true);
    });

    it('returns false for 172.x.x.x outside the private range', () => {
      expect(isLanAddress('http://172.15.0.1')).toBe(false);
      expect(isLanAddress('http://172.32.0.1')).toBe(false);
    });

    it('returns true for 192.168.x.x (Class C)', () => {
      expect(isLanAddress('http://192.168.0.1')).toBe(true);
      expect(isLanAddress('http://192.168.1.100:9090')).toBe(true);
      expect(isLanAddress('http://192.168.255.255')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Link-local addresses
  // -----------------------------------------------------------------------
  describe('link-local addresses', () => {
    it('returns true for 169.254.x.x', () => {
      expect(isLanAddress('http://169.254.0.1')).toBe(true);
      expect(isLanAddress('http://169.254.255.255')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Tailscale range
  // -----------------------------------------------------------------------
  describe('Tailscale CGNAT range', () => {
    it('returns true for 100.64.x.x - 100.127.x.x', () => {
      expect(isLanAddress('http://100.64.0.1')).toBe(true);
      expect(isLanAddress('http://100.127.255.255')).toBe(true);
      expect(isLanAddress('http://100.100.100.100')).toBe(true);
    });

    it('returns false for 100.x.x.x outside Tailscale range', () => {
      expect(isLanAddress('http://100.63.0.1')).toBe(false);
      expect(isLanAddress('http://100.128.0.1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // IPv6 private addresses
  // -----------------------------------------------------------------------
  describe('IPv6 private addresses', () => {
    it('returns true for bracket-wrapped IPv6 loopback', () => {
      expect(isLanAddress('http://[::1]')).toBe(true);
      expect(isLanAddress('http://[::1]:8080')).toBe(true);
    });

    it('returns true for bracket-wrapped IPv6 link-local and unique local', () => {
      expect(isLanAddress('http://[fe80::1]')).toBe(true);
      expect(isLanAddress('http://[fc00::1]')).toBe(true);
      expect(isLanAddress('http://[fd00::abc]')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Public addresses
  // -----------------------------------------------------------------------
  describe('public addresses', () => {
    it('returns false for public IPv4', () => {
      expect(isLanAddress('http://8.8.8.8')).toBe(false);
      expect(isLanAddress('http://1.1.1.1')).toBe(false);
      expect(isLanAddress('http://203.0.113.50')).toBe(false);
    });

    it('returns false for domain names', () => {
      expect(isLanAddress('http://example.com')).toBe(false);
      expect(isLanAddress('https://google.com')).toBe(false);
      expect(isLanAddress('http://my-server.local.example.com')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid / edge cases
  // -----------------------------------------------------------------------
  describe('invalid / edge cases', () => {
    it('returns false for invalid IP octets > 255', () => {
      expect(isLanAddress('http://10.256.0.1')).toBe(false);
      expect(isLanAddress('http://192.168.1.999')).toBe(false);
    });

    it('returns false for invalid URL', () => {
      expect(isLanAddress('not-a-url')).toBe(false);
      expect(isLanAddress('')).toBe(false);
    });

    it('returns false for non-IPv6-private addresses', () => {
      expect(isLanAddress('http://[2001:db8::1]')).toBe(false);
    });
  });
});
