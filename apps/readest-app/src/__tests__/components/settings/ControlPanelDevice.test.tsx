// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const platform = vi.hoisted(() => ({ isWindowsApp: false }));

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
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false, ...platform } }),
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
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

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
  platform.isWindowsApp = false;
  vi.mocked(invoke).mockReset();
});

const thumbnailSwitch = () =>
  document.querySelector<HTMLInputElement>(
    '[data-setting-id="settings.control.explorerThumbnails"] input',
  )!;

describe('Windows Explorer thumbnail preference (#7206)', () => {
  it('is hidden outside the Windows app and does not query the registry', () => {
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    expect(screen.queryByText('Use Readest for File Explorer thumbnails')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('starts off, persists an explicit opt-in, and reloads the device preference', async () => {
    platform.isWindowsApp = true;
    let enabled = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_explorer_thumbnails_enabled') return enabled;
      if (command === 'set_explorer_thumbnails_enabled') {
        enabled = (args as { enabled: boolean }).enabled;
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const panel = render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    await waitFor(() => expect(thumbnailSwitch().disabled).toBe(false));
    expect(thumbnailSwitch().checked).toBe(false);
    fireEvent.click(thumbnailSwitch());
    await waitFor(() => expect(thumbnailSwitch().checked).toBe(true));
    expect(invoke).toHaveBeenCalledWith('set_explorer_thumbnails_enabled', { enabled: true });
    expect(saveSysSettings).not.toHaveBeenCalled();
    panel.unmount();
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    await waitFor(() => expect(thumbnailSwitch().checked).toBe(true));
    fireEvent.click(thumbnailSwitch());
    await waitFor(() => expect(thumbnailSwitch().checked).toBe(false));
    expect(invoke).toHaveBeenCalledWith('set_explorer_thumbnails_enabled', { enabled: false });
  });

  it('allows an explicit opt-in after the initial preference read fails', async () => {
    platform.isWindowsApp = true;
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Invalid registry value'));
    vi.mocked(invoke).mockResolvedValue(undefined);
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(thumbnailSwitch().disabled).toBe(false);
    fireEvent.click(thumbnailSwitch());
    await waitFor(() => expect(thumbnailSwitch().checked).toBe(true));
    expect(invoke).toHaveBeenCalledWith('set_explorer_thumbnails_enabled', { enabled: true });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the saved value while a write is pending and after a failed write', async () => {
    platform.isWindowsApp = true;
    let rejectWrite: (error: Error) => void = () => {};
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'get_explorer_thumbnails_enabled') return Promise.resolve(true);
      return new Promise((_resolve, reject) => {
        rejectWrite = reject;
      });
    });
    render(<ControlPanel bookKey='test' onRegisterReset={() => {}} />);
    await waitFor(() => expect(thumbnailSwitch().checked).toBe(true));
    fireEvent.click(thumbnailSwitch());
    expect(thumbnailSwitch().disabled).toBe(true);
    expect(thumbnailSwitch().checked).toBe(true);
    await act(async () => rejectWrite(new Error('Access denied')));
    expect(thumbnailSwitch().checked).toBe(true);
    expect(thumbnailSwitch().disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not update File Explorer thumbnails',
    );
  });
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
  it('is on by default', () => {
    expect(DEFAULT_SYSTEM_SETTINGS.hideBookshelfPageButtons).toBe(true);
  });

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
