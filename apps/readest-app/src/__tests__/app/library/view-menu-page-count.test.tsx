import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ViewMenu from '@/app/library/components/ViewMenu';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/utils/access', () => ({ getUserID: async () => null }));
vi.mock('@/services/sync/replicaSync', () => ({ getReplicaSync: () => null }));
vi.mock('@/helpers/settings', () => ({
  saveSysSettings: async (_env: unknown, key: string, value: unknown) => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, [key]: value },
    });
  },
}));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryViewMode: 'grid',
      libraryShowPageCount: false,
    } as SystemSettings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(cleanup);

describe('ViewMenu show page count toggle (#6909)', () => {
  it('renders the Show page count toggle in ViewMenu', () => {
    render(<ViewMenu />);
    expect(screen.getByText('Show page count')).toBeTruthy();
  });

  it('toggles libraryShowPageCount on click', async () => {
    render(<ViewMenu />);
    const toggleButton = screen.getByText('Show page count');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.libraryShowPageCount).toBe(true);
    });

    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.libraryShowPageCount).toBe(false);
    });
  });
});
