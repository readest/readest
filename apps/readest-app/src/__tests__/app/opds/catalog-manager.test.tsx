import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CatalogManager } from '@/app/opds/components/CatalogManager';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';

// Simple interpolating stub so assertions can match the rendered copy
// (including the catalog name) instead of raw i18n keys.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? key.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? '')) : key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isOnlineCatalogsAccessible: false } }),
}));

vi.mock('@/services/opds', () => ({
  loadSubscriptionState: vi.fn(async () => ({ lastCheckedAt: 0, failedEntries: [] })),
  deleteSubscriptionState: vi.fn(),
}));

vi.mock('@/app/opds/utils/opdsUtils', () => ({
  getUnaddedPopularCatalogs: () => [],
  validateOPDSURL: vi.fn(),
}));

vi.mock('@/services/sync/passphraseGate', () => ({ ensurePassphraseUnlocked: vi.fn() }));
vi.mock('@/services/sync/syncCategories', () => ({ isCredentialsSyncEnabled: () => false }));

// Replica publish fans out to the network — stub it so the store stays hermetic.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

const makeCatalog = (overrides: Partial<OPDSCatalog>): OPDSCatalog => ({
  id: 'c1',
  contentId: 'c1',
  name: 'My Library',
  url: 'https://example.com/opds',
  addedAt: 1700000000000,
  ...overrides,
});

const seed = (catalogs: OPDSCatalog[]) => {
  useSettingsStore.setState({
    settings: { opdsCatalogs: catalogs } as unknown as SystemSettings,
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
  useCustomOPDSStore.setState({ catalogs, loading: false });
};

const autoDownloadToggle = () => screen.getByRole('checkbox', { name: 'Auto-download' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('CatalogManager auto-download confirmation (#5746)', () => {
  test('flipping the list toggle on asks for confirmation instead of enabling', async () => {
    seed([makeCatalog({})]);
    render(<CatalogManager />);

    fireEvent.click(autoDownloadToggle());

    expect(await screen.findByText('Auto-download from “My Library”?')).toBeTruthy();
    expect(useCustomOPDSStore.getState().getCatalog('c1')!.autoDownload).toBeFalsy();
  });

  test('confirming enables auto-download and schedules the subscription check', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    seed([makeCatalog({})]);
    render(<CatalogManager />);

    fireEvent.click(autoDownloadToggle());
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() =>
      expect(useCustomOPDSStore.getState().getCatalog('c1')!.autoDownload).toBe(true),
    );
    expect(screen.queryByText('Auto-download from “My Library”?')).toBeNull();

    expect(dispatch).not.toHaveBeenCalledWith('check-opds-subscriptions');
    vi.advanceTimersByTime(5000);
    expect(dispatch).toHaveBeenCalledWith('check-opds-subscriptions');
  });

  test('cancelling leaves auto-download untouched and starts no download', async () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    seed([makeCatalog({})]);
    render(<CatalogManager />);

    fireEvent.click(autoDownloadToggle());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Auto-download from “My Library”?')).toBeNull());
    expect(useCustomOPDSStore.getState().getCatalog('c1')!.autoDownload).toBeFalsy();
    expect(autoDownloadToggle()).toHaveProperty('checked', false);

    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalledWith('check-opds-subscriptions');
  });

  test('turning an enabled catalog off also confirms, with its own copy', async () => {
    seed([makeCatalog({ autoDownload: true })]);
    render(<CatalogManager />);

    fireEvent.click(autoDownloadToggle());

    expect(await screen.findByText('Stop auto-downloading from “My Library”?')).toBeTruthy();
    expect(useCustomOPDSStore.getState().getCatalog('c1')!.autoDownload).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Turn Off' }));
    await waitFor(() =>
      expect(useCustomOPDSStore.getState().getCatalog('c1')!.autoDownload).toBe(false),
    );
  });
});

describe('CatalogManager drag-to-reorder (#5746)', () => {
  test('renders a drag handle on every catalog card', () => {
    seed([
      makeCatalog({ id: 'c1', contentId: 'c1', name: 'One', url: 'https://one.example/opds' }),
      makeCatalog({ id: 'c2', contentId: 'c2', name: 'Two', url: 'https://two.example/opds' }),
    ]);
    render(<CatalogManager />);

    expect(screen.getAllByLabelText('Drag to reorder')).toHaveLength(2);
  });

  test('renders no drag handle when a single catalog leaves nothing to reorder', () => {
    seed([makeCatalog({})]);
    render(<CatalogManager />);

    expect(screen.queryByLabelText('Drag to reorder')).toBeNull();
  });
});
