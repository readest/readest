import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  hasScreenBrightness: true,
  autoScreenBrightness: false,
  screenBrightness: -1,
  setScreenBrightness: vi.fn(),
  syncScreenBrightness: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasScreenBrightness: h.hasScreenBrightness } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      autoScreenBrightness: h.autoScreenBrightness,
      screenBrightness: h.screenBrightness,
    },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    setScreenBrightness: h.setScreenBrightness,
    syncScreenBrightness: h.syncScreenBrightness,
  }),
}));

import { useScreenBrightness } from '@/app/reader/hooks/useScreenBrightness';

function Wrapper() {
  useScreenBrightness();
  return null;
}

const setup = () => render(<Wrapper />);

describe('useScreenBrightness', () => {
  beforeEach(() => {
    h.hasScreenBrightness = true;
    h.autoScreenBrightness = false;
    h.screenBrightness = -1;
    h.setScreenBrightness.mockReset();
    h.syncScreenBrightness.mockReset();
  });
  afterEach(() => cleanup());

  const becomeVisible = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('re-reads the device brightness when the app returns to the foreground', () => {
    h.autoScreenBrightness = true;
    setup();
    becomeVisible('visible');
    expect(h.syncScreenBrightness).toHaveBeenCalled();
  });

  it('does not re-read while the app is going into the background', () => {
    h.autoScreenBrightness = true;
    setup();
    becomeVisible('hidden');
    expect(h.syncScreenBrightness).not.toHaveBeenCalled();
  });

  it('applies the saved manual brightness when auto is off', () => {
    h.autoScreenBrightness = false;
    h.screenBrightness = 40;
    setup();
    expect(h.setScreenBrightness).toHaveBeenCalledWith(0.4);
  });

  it('releases control to the system when auto brightness is on', () => {
    h.autoScreenBrightness = true;
    h.screenBrightness = 40;
    setup();
    expect(h.setScreenBrightness).toHaveBeenCalledWith(-1);
  });

  it('releases control when no manual brightness has been set', () => {
    h.autoScreenBrightness = false;
    h.screenBrightness = -1;
    setup();
    expect(h.setScreenBrightness).toHaveBeenCalledWith(-1);
  });

  it('releases control on unmount', () => {
    h.autoScreenBrightness = false;
    h.screenBrightness = 40;
    const utils = setup();
    h.setScreenBrightness.mockClear();
    utils.unmount();
    expect(h.setScreenBrightness).toHaveBeenCalledWith(-1);
  });

  it('re-applies the manual brightness when switching off auto brightness', () => {
    h.autoScreenBrightness = true;
    h.screenBrightness = 40;
    const utils = setup();
    h.setScreenBrightness.mockClear();
    h.autoScreenBrightness = false;
    utils.rerender(<Wrapper />);
    expect(h.setScreenBrightness).toHaveBeenLastCalledWith(0.4);
  });

  it('is inert when the platform lacks screen brightness control', () => {
    h.hasScreenBrightness = false;
    h.screenBrightness = 40;
    setup();
    expect(h.setScreenBrightness).not.toHaveBeenCalled();
  });
});
