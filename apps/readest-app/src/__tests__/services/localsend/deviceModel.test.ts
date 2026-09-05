import { describe, expect, it } from 'vitest';
import { ipTag, localSendDeviceModel, preferredIpTag } from '@/services/localsend/deviceModel';

describe('localSendDeviceModel', () => {
  it('maps each OS to the name peers show as the device tag', () => {
    expect(localSendDeviceModel('android', false)).toBe('Android');
    expect(localSendDeviceModel('ios', false)).toBe('iOS');
    expect(localSendDeviceModel('ios', true)).toBe('iPadOS');
    expect(localSendDeviceModel('macos', false)).toBe('macOS');
    expect(localSendDeviceModel('windows', false)).toBe('Windows');
    expect(localSendDeviceModel('linux', false)).toBe('Linux');
  });

  it('falls back to Readest for an unknown platform', () => {
    expect(localSendDeviceModel('unknown', false)).toBe('Readest');
  });

  it('only splits iPad out of iOS, never other platforms', () => {
    expect(localSendDeviceModel('android', true)).toBe('Android');
    expect(localSendDeviceModel('macos', true)).toBe('macOS');
  });
});

describe('ipTag', () => {
  it('tags an IPv4 address with its last octet', () => {
    expect(ipTag('192.168.2.120')).toBe('#120');
    expect(ipTag('10.0.0.7')).toBe('#7');
  });

  it('returns null for anything that is not a dotted IPv4 address', () => {
    expect(ipTag('fe80::1')).toBe(null);
    expect(ipTag('fe80::1%3')).toBe(null);
    expect(ipTag('mac.local')).toBe(null);
    expect(ipTag('')).toBe(null);
    expect(ipTag('1.2.3.256')).toBe(null);
  });
});

describe('preferredIpTag', () => {
  it('names one address, not every interface the device happens to have', () => {
    // An iPhone on Wi-Fi and plugged into a Mac: the settings row used to read
    // "#100 #99 #245", none of which a peer could be matched against.
    expect(preferredIpTag(['192.168.2.99', '169.254.109.245'])).toBe('#99');
  });

  it('prefers a routable address over an autoconfigured link-local one', () => {
    expect(preferredIpTag(['169.254.109.245', '192.168.2.99'])).toBe('#99');
    expect(preferredIpTag(['169.254.109.245'])).toBe('#245');
  });

  it('is order independent, so the tag never changes between reads', () => {
    const hosts = ['192.168.2.99', '10.0.0.100', '169.254.109.245'];
    expect(preferredIpTag(hosts)).toBe(preferredIpTag([...hosts].reverse()));
  });

  it('ignores anything that is not a dotted IPv4 address', () => {
    expect(preferredIpTag(['fe80::1%3', 'mac.local', '192.168.2.99'])).toBe('#99');
    expect(preferredIpTag(['fe80::1', ''])).toBe(null);
    expect(preferredIpTag([])).toBe(null);
  });
});
