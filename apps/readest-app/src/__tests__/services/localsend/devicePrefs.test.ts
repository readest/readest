import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLocalSendAlias,
  isLocalSendEnabled,
  setLocalSendAlias,
  setLocalSendEnabled,
} from '@/services/localsend/devicePrefs';

const ENABLED_KEY = 'readest-localsend-enabled';

describe('Nearby BookDrop enable preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stays off until the user turns it on', () => {
    // Load-bearing, not incidental: starting the service joins a multicast
    // group and binds a LAN listener, which makes iOS raise its Local Network
    // prompt at first launch. A decline there is sticky and would break the
    // feature for good, so nothing starts before the user asks for it.
    expect(isLocalSendEnabled()).toBe(false);
  });

  it('treats any value other than "true" as off', () => {
    localStorage.setItem(ENABLED_KEY, 'false');
    expect(isLocalSendEnabled()).toBe(false);
    localStorage.setItem(ENABLED_KEY, '');
    expect(isLocalSendEnabled()).toBe(false);
  });

  it('round-trips the toggle both ways', () => {
    setLocalSendEnabled(true);
    expect(localStorage.getItem(ENABLED_KEY)).toBe('true');
    expect(isLocalSendEnabled()).toBe(true);
    setLocalSendEnabled(false);
    expect(isLocalSendEnabled()).toBe(false);
  });

  it('leaves the alias empty until the user names the device', () => {
    expect(getLocalSendAlias()).toBe('');
    setLocalSendAlias('Study Mac');
    expect(getLocalSendAlias()).toBe('Study Mac');
  });
});
