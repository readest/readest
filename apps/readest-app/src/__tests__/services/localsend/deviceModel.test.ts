import { describe, expect, it } from 'vitest';
import { localSendDeviceModel } from '@/services/localsend/deviceModel';

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
