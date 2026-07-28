import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {}, envConfig: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
// Clip pipeline collaborators — should never be reached for share links; stub
// so an accidental article-clip can't blow up the test environment.
vi.mock('@/services/send/clipOptions', () => ({ getClipOptions: () => ({}) }));
vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: vi.fn(),
}));
vi.mock('@/services/ingestService', () => ({ ingestFile: vi.fn() }));

import { useClipUrlIngress } from '@/hooks/useClipUrlIngress';
import { eventDispatcher } from '@/utils/event';

beforeEach(() => {
  // Reject so clipAndImport short-circuits right after invoke('clip_url') —
  // we only need to observe whether the clip was attempted.
  invokeMock.mockReset().mockRejectedValue(new Error('stub'));
});

describe('useClipUrlIngress share-extension pending saves', () => {
  type PendingHook = (saves: unknown[]) => boolean;
  const getPendingHook = (): PendingHook => {
    const w = window as unknown as { __readestOnShareExtensionPending?: PendingHook };
    expect(w.__readestOnShareExtensionPending).toBeTypeOf('function');
    return w.__readestOnShareExtensionPending!;
  };

  it('converts htmlFile saves directly without re-fetching via clip_url', async () => {
    const { convertToEpubWithWorker } = await import('@/services/send/conversion/conversionWorker');
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'plugin:native-bridge|read_share_clip_html') {
        return { html: '<html><body>captured from Safari</body></html>' };
      }
      throw new Error(`unexpected invoke: ${String(cmd)}`);
    });
    renderHook(() => useClipUrlIngress());
    getPendingHook()([{ url: 'https://example.com/paywalled', htmlFile: 'abc.html' }]);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:native-bridge|read_share_clip_html',
        expect.objectContaining({ payload: expect.objectContaining({ fileName: 'abc.html' }) }),
      );
    });
    await vi.waitFor(() => {
      expect(convertToEpubWithWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'page',
          html: '<html><body>captured from Safari</body></html>',
          url: 'https://example.com/paywalled',
        }),
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith('clip_url', expect.anything());
  });

  it('falls back to clip_url when the shared HTML cannot be read', async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'plugin:native-bridge|read_share_clip_html') {
        throw new Error('file vanished');
      }
      throw new Error('stub');
    });
    renderHook(() => useClipUrlIngress());
    getPendingHook()([{ url: 'https://example.com/paywalled', htmlFile: 'gone.html' }]);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'clip_url',
        expect.objectContaining({ url: 'https://example.com/paywalled' }),
      );
    });
  });
});

describe('useClipUrlIngress deep-link routing', () => {
  it('does NOT run the article clipper on share deep links', async () => {
    renderHook(() => useClipUrlIngress());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://web.readest.com/s/Qmup0X1A8ovl2FmKJKA8mB'],
    });
    await Promise.resolve();
    // Share links belong to useOpenShareLink; the clipper must leave them alone.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('still clips ordinary article URLs', async () => {
    renderHook(() => useClipUrlIngress());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://example.com/some-article'],
    });
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith(
      'clip_url',
      expect.objectContaining({ url: 'https://example.com/some-article' }),
    );
  });
});
