import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPairedDevice,
  canAutoAccept,
  getPairedDevices,
  isPairedDevice,
  refreshPairedDevice,
  removePairedDevice,
} from '@/services/localsend/pairedDevices';

const PAIRED_KEY = 'readest-localsend-paired';

describe('paired devices trust store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and reports unknown fingerprints unpaired', () => {
    expect(getPairedDevices()).toEqual([]);
    expect(isPairedDevice('F1')).toBe(false);
  });

  it('adds, lists, and removes paired devices by fingerprint', () => {
    addPairedDevice({ fingerprint: 'F1', alias: 'Phone', deviceModel: 'Android' });
    addPairedDevice({ fingerprint: 'F2', alias: 'Laptop', deviceModel: 'macOS' });
    expect(getPairedDevices().map((d) => d.fingerprint)).toEqual(['F1', 'F2']);
    expect(isPairedDevice('F1')).toBe(true);
    expect(getPairedDevices()[0]!.pairedAt).toBeGreaterThan(0);
    removePairedDevice('F1');
    expect(isPairedDevice('F1')).toBe(false);
    expect(getPairedDevices().map((d) => d.fingerprint)).toEqual(['F2']);
  });

  it('re-adding an existing fingerprint updates in place instead of duplicating', () => {
    addPairedDevice({ fingerprint: 'F1', alias: 'Phone', deviceModel: 'Android' });
    addPairedDevice({ fingerprint: 'F1', alias: 'Phone 2', deviceModel: 'Android' });
    expect(getPairedDevices()).toHaveLength(1);
    expect(getPairedDevices()[0]!.alias).toBe('Phone 2');
  });

  it('refreshes alias and model for a known fingerprint, ignores unknown ones', () => {
    addPairedDevice({ fingerprint: 'F1', alias: 'Old Name', deviceModel: null });
    refreshPairedDevice('F1', 'New Name', 'Android');
    expect(getPairedDevices()[0]!.alias).toBe('New Name');
    expect(getPairedDevices()[0]!.deviceModel).toBe('Android');
    refreshPairedDevice('F9', 'Ghost', 'iOS');
    expect(getPairedDevices()).toHaveLength(1);
    expect(isPairedDevice('F9')).toBe(false);
  });

  it('survives malformed stored JSON by treating the store as empty', () => {
    localStorage.setItem(PAIRED_KEY, 'not json');
    expect(getPairedDevices()).toEqual([]);
    addPairedDevice({ fingerprint: 'F1', alias: 'Phone', deviceModel: null });
    expect(getPairedDevices()).toHaveLength(1);
  });
});

describe('canAutoAccept', () => {
  beforeEach(() => {
    localStorage.clear();
    addPairedDevice({ fingerprint: 'F1', alias: 'Phone', deviceModel: 'Android' });
  });

  it('accepts only a paired, cert-verified sender when entitled', () => {
    expect(canAutoAccept({ fingerprint: 'F1', certVerified: true }, true)).toBe(true);
  });

  it('never accepts a cert-less sender, even a paired one', () => {
    // The body fingerprint is spoofable: a hostile LAN peer can claim any
    // fingerprint in the prepare-upload body. Only the TLS-verified cert
    // fingerprint may skip the confirmation dialog.
    expect(canAutoAccept({ fingerprint: 'F1', certVerified: false }, true)).toBe(false);
  });

  it('never accepts an unpaired sender', () => {
    expect(canAutoAccept({ fingerprint: 'F2', certVerified: true }, true)).toBe(false);
  });

  it('never auto-accepts without the plan entitlement (records persist)', () => {
    expect(canAutoAccept({ fingerprint: 'F1', certVerified: true }, false)).toBe(false);
    expect(isPairedDevice('F1')).toBe(true);
  });
});
