import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Real deviceStore; only the native bridge is mocked, so the test sees whether
// the settings panel leaves a volume-key interception held.
const h = vi.hoisted(() => ({
  settings: {
    globalViewSettings: { volumeKeysToFlip: true },
    hardwarePageTurner: {
      enabled: false,
      bindings: {
        pagePrev: null,
        pageNext: null,
        sectionPrev: null,
        sectionNext: null,
        refresh: null,
      },
    },
  },
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: true } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/hooks/useEinkRefreshSupported', () => ({
  useEinkRefreshSupported: () => false,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: h.settings }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => h.settings.globalViewSettings }),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
  saveViewSettings: vi.fn(),
}));

vi.mock('@/components/settings/primitives', () => ({
  BoxedList: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SettingsRow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SettingsSwitchRow: ({ label, onChange }: { label: string; onChange: () => void }) => (
    <button type='button' onClick={onChange}>
      {label}
    </button>
  ),
}));

import { useDeviceControlStore } from '@/store/deviceStore';
import PageTurnerSettings from '@/components/settings/PageTurnerSettings';

beforeEach(() => {
  vi.clearAllMocks();
  useDeviceControlStore.setState({ volumeKeysIntercepted: false, volumeKeysInterceptionCount: 0 });
});

afterEach(() => {
  cleanup();
});

describe('PageTurnerSettings volume keys (#7119)', () => {
  test('reopening the panel and turning Use Volume Keys off leaves no interception held', () => {
    render(<PageTurnerSettings bookKey='book-1' />);
    cleanup();
    render(<PageTurnerSettings bookKey='book-1' />);

    fireEvent.click(screen.getByText('Use Volume Keys'));

    expect(useDeviceControlStore.getState().volumeKeysInterceptionCount).toBe(0);
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
  });
});
