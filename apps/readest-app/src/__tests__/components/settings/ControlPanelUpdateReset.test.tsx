import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { getDefaultViewSettings } from '@/services/settingsService';
import { useSettingsStore } from '@/store/settingsStore';
import ControlPanel from '@/components/settings/ControlPanel';

const storageKey = 'control-panel-update-reset';
const defaultViewSettings = getDefaultViewSettings({
  fs: {} as FileSystem,
  isMobile: false,
  isEink: false,
  isAppDataSandbox: false,
});
const appService = {
  isMobileApp: false,
  hasUpdater: true,
  getDefaultViewSettings: () => defaultViewSettings,
  saveSettings: async (settings: SystemSettings) => {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  },
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appService }, appService }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const readerState = {
  bookKeys: [],
  getView: () => null,
  getViews: () => [],
  getViewSettings: () => undefined,
  getViewState: () => undefined,
  setViewSettings: vi.fn(),
  recreateViewer: vi.fn(),
};
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(() => readerState, { getState: () => readerState }),
}));
const bookState = {
  getBookData: () => undefined,
  getConfig: () => undefined,
  saveConfig: vi.fn(),
};
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: Object.assign(() => bookState, { getState: () => bookState }),
}));
vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: vi.fn() }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/share', () => ({ canShareText: () => true }));
vi.mock('@/utils/telemetry', () => ({ optInTelemetry: vi.fn(), optOutTelemetry: vi.fn() }));
vi.mock('@/components/settings/PageTurnerSettings', () => ({ default: () => null }));
vi.mock('@/utils/style', () => ({ getStyles: () => '' }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));

const autoCheckSwitch = () =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: /^Check Updates on Start/ });
const nightlySwitch = () =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: /^Nightly Builds/ });
const savedSettings = (): SystemSettings => JSON.parse(localStorage.getItem(storageKey)!);

beforeEach(() => {
  appService.hasUpdater = true;
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      globalViewSettings: { ...defaultViewSettings },
      autoCheckUpdates: false,
      updateChannel: 'nightly',
      telemetryEnabled: false,
      gamepadEnabled: false,
    } as SystemSettings,
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(storageKey);
});

describe('Behavior update settings reset', () => {
  it('restores the update defaults in the controls and persisted settings', async () => {
    const registerReset = vi.fn<(reset: () => void) => void>();
    const panel = render(<ControlPanel bookKey='' onRegisterReset={registerReset} />);
    expect(autoCheckSwitch().checked).toBe(false);
    expect(nightlySwitch().checked).toBe(true);

    await act(async () => registerReset.mock.calls[0]![0]());

    expect.soft(autoCheckSwitch().checked).toBe(true);
    expect.soft(nightlySwitch().checked).toBe(false);
    expect.soft(savedSettings()).toMatchObject({
      autoCheckUpdates: true,
      updateChannel: 'stable',
      telemetryEnabled: false,
      gamepadEnabled: false,
    });

    panel.unmount();
    useSettingsStore.setState({ settings: savedSettings() });
    render(<ControlPanel bookKey='' onRegisterReset={() => {}} />);
    expect(autoCheckSwitch().checked).toBe(true);
    expect(nightlySwitch().checked).toBe(false);
  });

  it('resets preferences changed after the reset callback was registered', async () => {
    useSettingsStore.getState().setSettings({
      ...useSettingsStore.getState().settings,
      autoCheckUpdates: true,
      updateChannel: 'stable',
    });
    const registerReset = vi.fn<(reset: () => void) => void>();
    render(<ControlPanel bookKey='' onRegisterReset={registerReset} />);

    await act(async () => {
      fireEvent.click(autoCheckSwitch());
      fireEvent.click(nightlySwitch());
    });
    expect(autoCheckSwitch().checked).toBe(false);
    expect(nightlySwitch().checked).toBe(true);

    await act(async () => registerReset.mock.calls[0]![0]());
    await act(async () => registerReset.mock.calls[0]![0]());

    expect(autoCheckSwitch().checked).toBe(true);
    expect(nightlySwitch().checked).toBe(false);
    expect(savedSettings()).toMatchObject({ autoCheckUpdates: true, updateChannel: 'stable' });
  });

  it('leaves update preferences alone when the app has no updater', async () => {
    appService.hasUpdater = false;
    const registerReset = vi.fn<(reset: () => void) => void>();
    render(<ControlPanel bookKey='' onRegisterReset={registerReset} />);
    expect(screen.queryByRole('checkbox', { name: /^Nightly Builds/ })).toBeNull();

    await act(async () => registerReset.mock.calls[0]![0]());

    expect(savedSettings()).toMatchObject({ autoCheckUpdates: false, updateChannel: 'nightly' });
  });
});
