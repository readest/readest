import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  router: { push: vi.fn(), replace: vi.fn() },
  login: vi.fn(),
  opds: vi.fn(async (_verbose?: boolean) => {}),
  abs: vi.fn(async () => {}),
  pull: vi.fn(async (_full?: boolean, _verbose?: boolean) => {}),
  stages: [] as (() => Promise<void>)[],
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => h.router }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: (...args: unknown[]) => h.login(...args) }));
vi.mock('@/hooks/useOPDSSubscriptions', () => ({
  useOPDSSubscriptions: () => ({ checkOPDSSubscriptions: h.opds }),
}));
vi.mock('@/hooks/useABSSync', () => ({ useABSSync: () => ({ checkABSServers: h.abs }) }));
vi.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: (_ref: unknown, ...stages: (() => Promise<void>)[]) => {
    h.stages = stages;
  },
}));

import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryRefresh } from '@/app/library/hooks/useLibraryRefresh';

const defaults = DEFAULT_SYSTEM_SETTINGS as SystemSettings;
beforeEach(() => {
  vi.clearAllMocks();
  h.user = null;
  useSettingsStore.setState({ settings: { ...defaults, opdsCatalogs: [], absServers: [] } });
});
afterEach(cleanup);

for (const [stage, fullRefresh] of [false, true].entries()) {
  describe(`library refresh stage ${stage + 1}`, () => {
    const refresh = async () => {
      renderHook(() => useLibraryRefresh({ current: null }, h.pull));
      await act(() => h.stages[stage]!());
    };

    it('refreshes OPDS subscriptions without a Readest account', async () => {
      useSettingsStore.getState().settings.opdsCatalogs = [
        { id: 'opds', name: 'Books', url: 'https://books.example/opds', autoDownload: true },
      ];
      await refresh();
      expect(h.login).not.toHaveBeenCalled();
      expect(h.opds).toHaveBeenCalledWith(true);
      expect(h.pull).toHaveBeenCalledWith(fullRefresh, true);
    });

    it.each([
      'webdav',
      'googleDrive',
      's3',
      'onedrive',
      'icloud',
      'kosync',
      'bookorbit',
    ] as const)('does not require a Readest account when %s is enabled', async (provider) => {
      const settings = useSettingsStore.getState().settings;
      useSettingsStore.setState({
        settings: { ...settings, [provider]: { ...settings[provider], enabled: true } },
      });
      await refresh();
      expect(h.login).not.toHaveBeenCalled();
      expect(h.pull).toHaveBeenCalledWith(fullRefresh, true);
    });

    it('refreshes Audiobookshelf without a Readest account', async () => {
      useSettingsStore.getState().settings.absServers = [
        { id: 'abs', name: 'Audio', url: 'https://audio.example' },
      ];
      await refresh();
      expect(h.login).not.toHaveBeenCalled();
      expect(h.abs).toHaveBeenCalledOnce();
    });

    it('prompts for sign-in when no external sources are configured', async () => {
      await refresh();
      expect(h.login).toHaveBeenCalledWith(h.router);
      expect(h.pull).not.toHaveBeenCalled();
      expect(h.opds).not.toHaveBeenCalled();
      expect(h.abs).not.toHaveBeenCalled();
    });

    it('ignores disabled and deleted sources when deciding whether to prompt', async () => {
      useSettingsStore.getState().settings.opdsCatalogs = [
        { id: 'off', name: 'Off', url: 'https://books.example', disabled: true },
        { id: 'gone', name: 'Gone', url: 'https://books.example', deletedAt: 1 },
      ];
      useSettingsStore.getState().settings.absServers = [
        { id: 'off', name: 'Off', url: 'https://audio.example', disabled: true },
        { id: 'gone', name: 'Gone', url: 'https://audio.example', deletedAt: 1 },
      ];
      await refresh();
      expect(h.login).toHaveBeenCalledOnce();
    });

    it('keeps signed-in cloud refresh and waits for source checks to finish', async () => {
      h.user = { id: 'test-user' };
      let finishOPDS!: () => void;
      h.opds.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishOPDS = resolve;
          }),
      );
      renderHook(() => useLibraryRefresh({ current: null }, h.pull));
      let completed = false;
      const pending = h.stages[stage]!().then(() => {
        completed = true;
      });
      await vi.waitFor(() => expect(h.opds).toHaveBeenCalledWith(true));
      expect(completed).toBe(false);
      finishOPDS();
      await pending;
      expect(h.login).not.toHaveBeenCalled();
      expect(h.pull).toHaveBeenCalledWith(fullRefresh, true);
      expect(h.abs).toHaveBeenCalledOnce();
    });
  });
}
