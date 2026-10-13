import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #6360: Nearby BookDrop is on by default and binds a LAN listener, yet it sat
 * last under "Content Sources", after rows that are all off until configured.
 * It now has its own section at the top of the panel, says what the device is
 * announced as, and can be switched off without opening its sub-page.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp: true } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', customizationPurchased: false }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {},
    requestedSubPage: null,
    setRequestedSubPage: vi.fn(),
  }),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/app/opds/components/CatalogManager', () => ({ CatalogManager: () => null }));

import IntegrationsPanel from '@/components/settings/IntegrationsPanel';
import { useLocalSendStore } from '@/store/localsendStore';
import { isLocalSendEnabled, setLocalSendEnabled } from '@/services/localsend/devicePrefs';
import { eventDispatcher } from '@/utils/event';

const bookDropSection = () =>
  document.querySelector('[data-setting-id="settings.integrations.localsend"]') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  useLocalSendStore.setState({ status: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IntegrationsPanel Nearby BookDrop section', () => {
  it('puts BookDrop in its own section ahead of every other integration', () => {
    render(<IntegrationsPanel />);
    const sections = Array.from(document.querySelectorAll('[data-setting-id]')).map((el) =>
      el.getAttribute('data-setting-id'),
    );
    expect(sections[0]).toBe('settings.integrations.localsend');
    expect(within(bookDropSection()).getByText('Local Network')).toBeTruthy();
    expect(within(bookDropSection()).getByText('Nearby BookDrop')).toBeTruthy();
    // No longer buried in Content Sources.
    const catalogs = document.querySelector(
      '[data-setting-id="settings.integrations.catalogs"]',
    ) as HTMLElement;
    expect(within(catalogs).queryByText('Nearby BookDrop')).toBeNull();
  });

  it('shows the announced device name while on', () => {
    useLocalSendStore.setState({ status: { alias: 'Study Mac' } as never });
    render(<IntegrationsPanel />);
    expect(within(bookDropSection()).getByText('Visible as Study Mac')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Enable Nearby BookDrop').checked).toBe(true);
  });

  it('switches BookDrop off inline and tells the service manager', () => {
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByLabelText('Enable Nearby BookDrop'));
    expect(isLocalSendEnabled()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('localsend-prefs-changed', {});
    expect(screen.getByLabelText<HTMLInputElement>('Enable Nearby BookDrop').checked).toBe(false);
    expect(within(bookDropSection()).getByText('Off')).toBeTruthy();
  });

  it('reflects a change made elsewhere, such as the BookDrop sub-page', () => {
    render(<IntegrationsPanel />);
    setLocalSendEnabled(false);
    void eventDispatcher.dispatch('localsend-prefs-changed', {});
    return vi.waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Enable Nearby BookDrop').checked).toBe(false),
    );
  });
});
