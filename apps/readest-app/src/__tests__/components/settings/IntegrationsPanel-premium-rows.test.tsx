// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * #7755: opening a Premium cloud-sync row while signed out went to /user,
 * which showed "Loading profile..." for a second before bouncing to /auth.
 * A signed-out reader now goes straight to sign-in; a signed-in free one
 * still gets the plans page.
 */

const push = vi.fn();
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp: true, isMacOSApp: true } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
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
vi.mock('@/services/sync/dataFlow/connectors', () => ({ getFlowConnectors: () => [] }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/app/opds/components/CatalogManager', () => ({ CatalogManager: () => null }));

import IntegrationsPanel from '@/components/settings/IntegrationsPanel';

const premiumRows = ['Google Drive', 'WebDAV', 'S3 Storage', 'OneDrive', 'iCloud'];

afterEach(() => {
  cleanup();
  push.mockClear();
  auth.user = null;
});

describe('IntegrationsPanel premium cloud-sync rows', () => {
  it.each(premiumRows)('opens sign-in directly for %s when signed out', (title) => {
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatch(/^\/auth\?redirect=/);
  });

  it.each(premiumRows)('opens the plans page for %s on a free plan', (title) => {
    auth.user = { id: 'u1' };
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatch(/^\/user\?redirect=/);
  });
});
