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
    // A converted book, so the hook has no reason to fall back to clip_url.
    vi.mocked(convertToEpubWithWorker).mockResolvedValue({
      file: new File(['epub'], 'Paywalled.epub'),
      title: 'Paywalled',
    } as Awaited<ReturnType<typeof convertToEpubWithWorker>>);
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
    const { ingestFile } = await import('@/services/ingestService');
    await vi.waitFor(() => expect(ingestFile).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith('clip_url', expect.anything());
  });

  it('imports shared text as a TXT book without clipping a URL', async () => {
    const { ingestFile } = await import('@/services/ingestService');
    const ingestMock = vi.mocked(ingestFile);
    ingestMock.mockReset().mockResolvedValue(null);
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'plugin:native-bridge|read_share_clip_html') {
        return { html: 'Gemini summary\n\nSee https://example.com/source for more.' };
      }
      throw new Error(`unexpected invoke: ${String(cmd)}`);
    });
    renderHook(() => useClipUrlIngress());
    getPendingHook()([{ url: '', textFile: 'note.txt', title: 'Gemini summary' }]);
    await vi.waitFor(() => expect(ingestMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:native-bridge|read_share_clip_html',
      expect.objectContaining({ payload: expect.objectContaining({ fileName: 'note.txt' }) }),
    );
    const file = ingestMock.mock.calls[0]![0].file as File;
    expect(file.name).toBe('Gemini summary.txt');
    expect(await file.text()).toBe('Gemini summary\n\nSee https://example.com/source for more.');
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

  it('does NOT run the article clipper on reader sign-in links', async () => {
    renderHook(() => useClipUrlIngress());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['https://web.readest.com/link?code=RQGF-WDCF'],
    });
    await Promise.resolve();
    // Sign-in links belong to useOpenDeviceLink, which opens the /link page.
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
