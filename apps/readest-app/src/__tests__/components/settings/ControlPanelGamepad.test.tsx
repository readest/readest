import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

/**
 * Settings > Behavior > Device > Gamepad Support (issue #5979).
 *
 * The reader polls the Web Gamepad API and replays every button as a
 * synthetic key event. On a Steam Deck that fights Steam Input, which is
 * already mapping the same physical buttons to keys, so every press lands
 * twice. There was no way to turn the built-in support off.
 */

const sysSettings: Record<string, unknown> = { gamepadEnabled: true };

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViews: () => [],
    getViewSettings: () => ({ scrolled: false, noContinuousScroll: false }),
    recreateViewer: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: false, book: { format: 'EPUB' } }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: {}, ...sysSettings } }),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: vi.fn() }),
}));

const saveSysSettings = vi.fn();
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
  saveSysSettings: (...args: unknown[]) => saveSysSettings(...args),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/share', () => ({
  canShareText: () => true,
}));

vi.mock('@/utils/telemetry', () => ({
  optInTelemetry: vi.fn(),
  optOutTelemetry: vi.fn(),
}));

// Unrelated to the Device section and pulls in the device-control store.
vi.mock('@/components/settings/PageTurnerSettings', () => ({
  default: () => null,
}));

vi.mock('@/utils/style', () => ({ getStyles: () => '' }));
vi.mock('@/utils/config', () => ({ getMaxInlineSize: () => 720 }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  applyPageTurnAttributes: vi.fn(),
}));

import ControlPanel from '@/components/settings/ControlPanel';

const gamepadSwitch = () =>
  screen
    .getByText('Gamepad Support')
    .closest('[data-setting-id="settings.control.gamepadEnabled"]')
    ?.querySelector('input') as HTMLInputElement | null;

afterEach(() => {
  cleanup();
  saveSysSettings.mockClear();
  sysSettings['gamepadEnabled'] = true;
});

describe('Settings > Behavior > Device > Gamepad Support', () => {
  it('reflects the saved gamepad preference', () => {
    sysSettings['gamepadEnabled'] = false;
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);

    expect(gamepadSwitch()?.checked).toBe(false);
  });

  it('persists the gamepad preference when toggled off', () => {
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    expect(gamepadSwitch()?.checked).toBe(true);

    fireEvent.click(gamepadSwitch()!);

    expect(saveSysSettings).toHaveBeenCalledWith({}, 'gamepadEnabled', false);
  });
});
