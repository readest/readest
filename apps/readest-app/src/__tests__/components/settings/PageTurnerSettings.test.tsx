import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HardwarePageTurnerSettings } from '@/types/settings';

const h = vi.hoisted(() => ({
  settings: {
    globalViewSettings: { volumeKeysToFlip: false },
    hardwarePageTurner: {
      enabled: true,
      bindings: {
        pagePrev: { source: 'dom', id: 'ArrowRight', label: 'Arrow Right' },
        pageNext: null,
        sectionPrev: null,
        sectionNext: null,
        refresh: null,
      },
    } satisfies HardwarePageTurnerSettings,
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: h.settings }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => h.settings.globalViewSettings }),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    setKeyLearnMode: vi.fn(),
    acquireVolumeKeyInterception: vi.fn(),
    releaseVolumeKeyInterception: vi.fn(),
  }),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
  saveViewSettings: vi.fn(),
}));

vi.mock('@/components/settings/primitives', () => ({
  BoxedList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsSwitchRow: () => null,
}));

import { saveSysSettings } from '@/helpers/settings';
import PageTurnerSettings from '@/components/settings/PageTurnerSettings';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('PageTurnerSettings key recorder', () => {
  test('waits through a modifier keydown and records the completed chord', () => {
    render(<PageTurnerSettings bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Next Page: Set key' }));

    fireEvent.keyDown(window, { key: 'Control', code: 'ControlRight', ctrlKey: true });
    expect(saveSysSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Next Page: Listening…' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });

    expect(saveSysSettings).toHaveBeenCalledWith(
      {},
      'hardwarePageTurner',
      expect.objectContaining({
        bindings: expect.objectContaining({
          pagePrev: { source: 'dom', id: 'ArrowRight', label: 'Arrow Right' },
          pageNext: {
            source: 'dom',
            id: 'ArrowRight',
            label: 'Arrow Right',
            ctrlKey: true,
          },
        }),
      }),
    );
    expect(screen.getByText('Ctrl + Arrow Right')).toBeTruthy();
  });

  test('records a released modifier when no chord key follows it', () => {
    render(<PageTurnerSettings bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Next Page: Set key' }));

    fireEvent.keyDown(window, { key: 'Control', code: 'ControlRight', ctrlKey: true });
    expect(saveSysSettings).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: 'Control', code: 'ControlRight' });

    expect(saveSysSettings).toHaveBeenCalledWith(
      {},
      'hardwarePageTurner',
      expect.objectContaining({
        bindings: expect.objectContaining({
          pageNext: { source: 'dom', id: 'ControlRight', label: 'ControlRight' },
        }),
      }),
    );
  });
});
