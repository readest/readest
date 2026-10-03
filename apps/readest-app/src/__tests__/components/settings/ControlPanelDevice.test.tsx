import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

/**
 * Settings > Behavior > Device switches: Gamepad Support (issue #5979) and
 * Hide Bookshelf Buttons.
 *
 * Gamepad Support (issue #5979).
 *
 * The reader polls the Web Gamepad API and replays every button as a
 * synthetic key event. On a Steam Deck that fights Steam Input, which is
 * already mapping the same physical buttons to keys, so every press lands
 * twice. There was no way to turn the built-in support off.
 */

const sysSettings: Record<string, unknown> = { gamepadEnabled: true };
const view = { bookEink: false, globalEink: false };

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
    getViewSettings: () => ({
      scrolled: false,
      noContinuousScroll: false,
      isEink: view.bookEink,
    }),
    recreateViewer: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: false, book: { format: 'EPUB' } }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { isEink: view.globalEink }, ...sysSettings },
  }),
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
vi.mock('@/utils/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/config')>()),
  getMaxInlineSize: () => 720,
}));
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
  view.bookEink = false;
  view.globalEink = false;
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

const hideButtonsSwitch = () =>
  screen
    .getByText('Hide Bookshelf Buttons')
    .closest('[data-setting-id="settings.control.hideBookshelfPageButtons"]')
    ?.querySelector('input') as HTMLInputElement | null;

describe('Settings > Behavior > Device > Hide Bookshelf Buttons', () => {
  // The library shows its e-ink buttons from the global E-Ink setting, so a
  // book with its own E-Ink value must not gate the switch.
  it('is enabled when the library is in e-ink mode but the book is not', () => {
    view.globalEink = true;
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);

    expect(hideButtonsSwitch()?.disabled).toBe(false);
  });

  it('is disabled when only the book is in e-ink mode', () => {
    view.bookEink = true;
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);

    expect(hideButtonsSwitch()?.disabled).toBe(true);
  });
});
