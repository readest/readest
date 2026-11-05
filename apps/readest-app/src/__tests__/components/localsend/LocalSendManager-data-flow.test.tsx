import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendEnd } from '@/services/localsend/types';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp: true, deleteFile: vi.fn() } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', customizationPurchased: false }),
}));
vi.mock('@/services/localsend/devicePrefs', () => ({
  getLocalSendAlias: () => 'Test',
  isLocalSendEnabled: () => true,
}));
vi.mock('@/utils/bridge', () => ({ setMulticastLock: vi.fn(async () => {}) }));
vi.mock('@/services/localsend/sounds', () => ({ playTransferDoneCue: vi.fn() }));
vi.mock('@/services/ingestService', () => ({ ingestFile: vi.fn() }));
vi.mock('@/services/localsend/bookFile', () => ({ resolveBookSendFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    h.handlers.set(name, handler);
    return () => {};
  }),
}));
vi.mock('@/services/localsend/service', () => ({
  startLocalSend: vi.fn(async () => ({ running: true, alias: 'Test' })),
  stopLocalSend: vi.fn(async () => {}),
  setLocalSendDiscoverable: vi.fn(async () => {}),
  isLocalSendAlive: vi.fn(async () => true),
  respondLocalSend: vi.fn(async () => true),
  cancelLocalSendReceive: vi.fn(async () => {}),
}));

import LocalSendManager from '@/components/localsend/LocalSendManager';
import { readFlowState } from '@/services/sync/dataFlow/log';
import { LOCALSEND_EVENTS } from '@/services/localsend/types';
import { useLocalSendStore } from '@/store/localsendStore';
import { ingestFile } from '@/services/ingestService';

const sendEnd = async (payload: Partial<SendEnd>, ownSend = true) => {
  await act(async () => {
    render(<LocalSendManager />);
  });
  if (ownSend) useLocalSendStore.getState().startSend('Phone', 'fp');
  await act(async () => {
    h.handlers.get(LOCALSEND_EVENTS.sendEnd)?.({
      payload: { sessionId: 's1', error: null, filesSent: 0, ...payload },
    });
  });
};

describe('LocalSendManager data flow when sending', () => {
  beforeEach(() => {
    localStorage.clear();
    useLocalSendStore.setState({ sendState: null });
  });
  afterEach(() => cleanup());

  it('counts the book files a peer took', async () => {
    await sendEnd({ status: 'sent', filesSent: 3 });

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'localsend',
      direction: 'push',
      kind: 'books',
      count: 3,
    });
  });

  it('records a transfer that failed', async () => {
    await sendEnd({ status: 'error', error: 'Connection reset' });

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'localsend',
      direction: 'push',
      error: 'Connection reset',
    });
  });

  it.each(['declined', 'cancelled'] as const)('treats %s as nothing moved', async (status) => {
    await sendEnd({ status });

    expect(readFlowState().entries).toEqual([]);
    expect(readFlowState().totals).toEqual({});
  });

  it("leaves another window's transfer to that window", async () => {
    await sendEnd({ status: 'sent', filesSent: 3 }, false);

    expect(readFlowState().entries).toEqual([]);
  });
});

describe('LocalSendManager data flow when receiving', () => {
  const receive = async () => {
    await act(async () => {
      render(<LocalSendManager />);
    });
    useLocalSendStore.setState({
      ownedSessions: { s1: { alias: 'Phone' } },
    } as never);
    await act(async () => {
      h.handlers.get(LOCALSEND_EVENTS.receiveFileDone)?.({
        payload: {
          sessionId: 's1',
          fileId: 'f',
          fileName: 'Dune.epub',
          path: '/tmp/d',
          error: null,
        },
      });
    });
  };

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(ingestFile).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => cleanup());

  it('does not count a file that imported no book', async () => {
    vi.mocked(ingestFile).mockResolvedValue(null as never);

    await receive();

    expect(readFlowState().totals['localsend:pull:books']).toMatchObject({ count: 0 });
  });

  it('records the error message, without an Error prefix', async () => {
    vi.mocked(ingestFile).mockRejectedValue(new Error('Unsupported file'));

    await receive();

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'localsend',
      direction: 'pull',
      error: 'Unsupported file',
    });
  });

  it('records a receive where files failed', async () => {
    await act(async () => {
      render(<LocalSendManager />);
    });
    useLocalSendStore.setState({ ownedSessions: { s1: { alias: 'Phone' } } } as never);
    await act(async () => {
      h.handlers.get(LOCALSEND_EVENTS.receiveEnd)?.({
        payload: { sessionId: 's1', reason: 'finished', received: 1, failed: 2 },
      });
    });

    expect(readFlowState().entries[0]).toMatchObject({ direction: 'pull' });
    expect(readFlowState().entries[0]?.error).toBeTruthy();
  });
});
