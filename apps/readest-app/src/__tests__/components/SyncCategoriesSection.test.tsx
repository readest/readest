import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The Manage Sync panel reads every row from the settings store, so it must
 * not render before that store is hydrated: a cold /user load would show each
 * category's default instead of the user's real choice, and flipping a row
 * would write the empty object back over their settings.
 */

const saveSettings = vi.fn(async () => {});
// useEnsureSettingsLoaded reads through this when the store is unhydrated.
const loadSettings = vi.fn(async () => useSettingsStore.getState().settings);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings, loadSettings }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import { SyncCategoriesSection } from '@/app/user/components/SyncCategoriesSection';

const base = {
  version: 1,
  webdav: { enabled: false },
  googleDrive: { enabled: false },
  s3: { enabled: false },
  onedrive: { enabled: false },
  icloud: { enabled: false },
  syncCategories: {},
} as unknown as SystemSettings;

const row = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SyncCategoriesSection', () => {
  test('renders nothing until the settings store is hydrated', () => {
    // A refreshed /user renders cold: every category would read its default,
    // misreporting the user's choices, and toggling a row would persist that
    // empty object over them.
    useSettingsStore.setState({ settings: {} as SystemSettings } as never);
    render(<SyncCategoriesSection />);
    expect(screen.queryByLabelText('Books')).toBeNull();
  });

  test('renders the categories once hydrated', () => {
    useSettingsStore.setState({ settings: base } as never);
    render(<SyncCategoriesSection />);
    expect(row('Books').checked).toBe(true);
    expect(row('App settings').checked).toBe(true);
  });
});
