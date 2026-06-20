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
