import { beforeEach, describe, expect, it } from 'vitest';
import {
  isLocalSendSoundsEnabled,
  setLocalSendSoundsEnabled,
  shouldPlayTransferCue,
} from '@/services/localsend/sounds';

describe('transfer sound preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to on', () => {
    expect(isLocalSendSoundsEnabled()).toBe(true);
  });

  it('round-trips the toggle', () => {
    setLocalSendSoundsEnabled(false);
    expect(isLocalSendSoundsEnabled()).toBe(false);
    setLocalSendSoundsEnabled(true);
    expect(isLocalSendSoundsEnabled()).toBe(true);
  });
});

describe('shouldPlayTransferCue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('plays by default off e-ink', () => {
    expect(shouldPlayTransferCue({ eink: false })).toBe(true);
  });

  it('never plays on e-ink regardless of the toggle', () => {
    setLocalSendSoundsEnabled(true);
    expect(shouldPlayTransferCue({ eink: true })).toBe(false);
  });

  it('respects the toggle', () => {
    setLocalSendSoundsEnabled(false);
    expect(shouldPlayTransferCue({ eink: false })).toBe(false);
  });
});
