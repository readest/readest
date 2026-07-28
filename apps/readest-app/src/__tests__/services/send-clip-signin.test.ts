import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@/services/send/clipOptions', () => ({ getClipOptions: () => ({}) }));
vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: vi.fn(),
}));

import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';
import { convertToEpubWithWorker } from '@/services/send/conversion/conversionWorker';
import { ConversionError } from '@/services/send/conversion/types';
import {
  clipPageWithSignInFallback,
  isClipCancelled,
  CLIP_SIGNIN_CONFIRM_EVENT,
} from '@/services/send/clipSignIn';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';

const _ = (k: string) => k;
const mobileAppService = { isMobileApp: true } as AppService;
const desktopAppService = { isMobileApp: false } as AppService;

// A Bloomberg-style paywall stub: real article markup, but only the free
// preview — well under the 400-char quality floor, page too small for the
// selector fallback.
const LOGIN_WALL_HTML = `<!doctype html>
<html lang="en">
  <head><title>At Sears, a Warring-Divisions Model</title></head>
  <body>
    <article>
      <h1>At Sears, a Warring-Divisions Model Adds to the Troubles</h1>
      <p>Eddie Lampert runs Sears like a hedge fund portfolio, with dozens of
      autonomous units competing for capital and attention.</p>
      <p>Subscribe to continue reading this article.</p>
    </article>
  </body>
</html>`;

describe('convertPageToEpub login-wall detection', () => {
  it('throws a ConversionError with the login_wall code for paywall stubs', async () => {
    const err = await convertPageToEpub(LOGIN_WALL_HTML, 'https://example.com/article').then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConversionError);
    expect((err as ConversionError).code).toBe('login_wall');
  });
});

describe('clipPageWithSignInFallback', () => {
  const convertMock = vi.mocked(convertToEpubWithWorker);
  const loginWall = () => new ConversionError('login wall', 'login_wall');
  const book = { file: new File(['x'], 'a.epub'), title: 'A', author: '' };

  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue('<html>stub</html>');
    convertMock.mockReset();
  });

  it('retries with interactive clip when the user confirms sign-in', async () => {
    convertMock.mockRejectedValueOnce(loginWall()).mockResolvedValueOnce(book);
    const onConfirm = vi.fn((event: CustomEvent) => {
      const { respond } = event.detail as { url: string; respond: (ok: boolean) => void };
      respond(true);
      return true;
    });
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      const result = await clipPageWithSignInFallback('https://example.com/a', _, mobileAppService);
      expect(result).toBe(book);
      expect(invokeMock).toHaveBeenCalledTimes(2);
      const secondOptions = invokeMock.mock.calls[1]![1] as { options: { interactive?: boolean } };
      expect(secondOptions.options.interactive).toBe(true);
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('rethrows the login-wall error when the user declines', async () => {
    convertMock.mockRejectedValueOnce(loginWall());
    const onConfirm = vi.fn((event: CustomEvent) => {
      const { respond } = event.detail as { respond: (ok: boolean) => void };
      respond(false);
      return true;
    });
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      await expect(
        clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
      ).rejects.toMatchObject({ code: 'login_wall' });
      expect(invokeMock).toHaveBeenCalledTimes(1);
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('rethrows without prompting when no confirm UI is mounted', async () => {
    convertMock.mockRejectedValueOnce(loginWall());
    await expect(
      clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
    ).rejects.toMatchObject({ code: 'login_wall' });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('does not offer interactive capture on desktop', async () => {
    convertMock.mockRejectedValueOnce(loginWall());
    const onConfirm = vi.fn(() => true);
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      await expect(
        clipPageWithSignInFallback('https://example.com/a', _, desktopAppService),
      ).rejects.toMatchObject({ code: 'login_wall' });
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('rethrows non-login-wall errors untouched', async () => {
    convertMock.mockRejectedValueOnce(new ConversionError('nope', 'parse_failed'));
    const onConfirm = vi.fn(() => true);
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      await expect(
        clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
      ).rejects.toMatchObject({ code: 'parse_failed' });
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });
});

describe('isClipCancelled', () => {
  it('recognizes the native cancel message in both Tauri reject shapes', () => {
    // Tauri `invoke` rejects with the raw string from the native side.
    expect(isClipCancelled('Capture cancelled')).toBe(true);
    expect(isClipCancelled(new Error('Capture cancelled'))).toBe(true);
    expect(isClipCancelled('Page took too long to load')).toBe(false);
    expect(isClipCancelled(undefined)).toBe(false);
  });
});
