import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/services/webBrowser/webBrowser', () => ({ openWebBrowser: vi.fn() }));
vi.mock('@/services/webBrowser/webBrowserOptions', () => ({
  getWebBrowserOptions: () => ({ labels: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isEink: false } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/nav', () => ({ navigateToReader: vi.fn() }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role='dialog'>{children}</div> : null,
}));

import WebSourcesDialog from '@/app/library/components/WebSourcesDialog';

afterEach(() => cleanup());

// Regression: with the real zustand store and no `webSources` saved yet, an
// unstable selector result (`?? []`) makes React loop until error #185 —
// exactly what crashed the library page on the first device run.
describe('WebSourcesDialog with the real settings store', () => {
  it('renders when settings.webSources is undefined', () => {
    useSettingsStore.setState({ settings: {} as SystemSettings });
    expect(() => render(<WebSourcesDialog isOpen onClose={() => {}} />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Add Source' })).toBeTruthy();
    // A store update unrelated to sources must not re-trigger a loop either.
    useSettingsStore.setState({ settings: { fontFamily: 'x' } as unknown as SystemSettings });
    expect(screen.getByRole('button', { name: 'Add Source' })).toBeTruthy();
  });
});
