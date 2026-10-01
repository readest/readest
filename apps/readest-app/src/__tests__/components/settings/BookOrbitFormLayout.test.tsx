import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(async () => 'linux') }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings: vi.fn() }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import BookOrbitForm from '@/components/settings/integrations/BookOrbitForm';

const settings = {
  bookorbit: {
    enabled: true,
    serverUrl: 'https://books.example.com',
    username: 'alice',
    userkey: 'key',
    password: '',
    deviceName: 'Readest',
    strategy: 'prompt',
    syncProgress: true,
    syncNotes: true,
    syncStats: true,
    syncBookStates: true,
  },
} as unknown as SystemSettings;

const hasStartInset = (el: Element) => /(^|\s)(px|ps)-4(\s|$)/.test(el.className);

beforeEach(() => {
  useSettingsStore.setState({ settings } as never);
});

afterEach(() => {
  cleanup();
});

describe('BookOrbitForm connected layout', () => {
  test('every row in the settings card is inset from the leading edge exactly once', () => {
    render(<BookOrbitForm onBack={vi.fn()} />);

    const labels = [
      'Sync Server Connected',
      'Auto Sync',
      'Sync Strategy',
      'Sync Reading Progress',
      'Sync Highlights and Bookmarks',
      'Sync Reading Statistics',
      'Sync Reading Status',
      'Device Name',
    ];
    for (const label of labels) {
      const row = screen.getByText(label).closest('.min-h-14');
      expect(row, label).not.toBeNull();
      const insets = Number(hasStartInset(row!)) + Number(hasStartInset(row!.parentElement!));
      expect(insets, label).toBe(1);
    }
  });
});
