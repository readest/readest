// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { CatalogManager } from '@/app/opds/components/CatalogManager';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

// Marks every looked-up string, so a description rendered without `_()` shows
// up in English.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => `[fr] ${key}`,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isOnlineCatalogsAccessible: true } }),
}));

vi.mock('@/services/opds', () => ({
  loadSubscriptionState: vi.fn(async () => ({ lastCheckedAt: 0, failedEntries: [] })),
  deleteSubscriptionState: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe('CatalogManager popular catalogs', () => {
  test('shows each built-in catalog description in the UI language', async () => {
    useSettingsStore.setState({
      settings: { opdsCatalogs: [] } as unknown as SystemSettings,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
    useCustomOPDSStore.setState({ catalogs: [], loading: false });

    render(<CatalogManager />);

    for (const description of [
      "World's largest collection of free ebooks",
      'Free and liberated ebooks, carefully produced for the true book lover',
      'Over 50,000 free ebooks',
      'Free ebooks from authors who have "unglued" their books',
      'Free public-domain books, comics, magazines and puzzles',
    ]) {
      expect(await screen.findByText(`[fr] ${description}`)).toBeTruthy();
    }
  });
});
