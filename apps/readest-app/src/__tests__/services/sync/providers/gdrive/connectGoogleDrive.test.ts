import { describe, expect, test, vi } from 'vitest';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  DRIVE_FILE_SCOPE,
} from '@/services/sync/providers/gdrive/connectGoogleDrive';
import { FileSyncError } from '@/services/sync/file/provider';
import type { FetchFn } from '@/services/sync/providers/gdrive/GoogleDriveProvider';
import type { TokenPersistence } from '@/services/sync/providers/gdrive/driveTokenStore';
import type { TokenSet } from '@/services/sync/providers/gdrive/auth/tokenStore';

const tokens: TokenSet = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999_999 };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makePersistence = (): TokenPersistence & {
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} => ({
  load: vi.fn(async () => null),
  save: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
});

describe('connectGoogleDrive', () => {
  test('runs OAuth with the drive.file scope, saves the token, returns the account label', async () => {
    const persistence = makePersistence();
    const runOAuth = vi.fn(async () => tokens);
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('/about')
        ? json({ user: { emailAddress: 'a@b.com' } })
        : new Response('', { status: 404 }),
    );

    const res = await connectGoogleDrive({
      clientId: 'cid',
      fetchFn: fetchFn as unknown as FetchFn,
      persistence,
      runOAuth,
    });

    expect(runOAuth).toHaveBeenCalledWith({ clientId: 'cid', scope: DRIVE_FILE_SCOPE }, fetchFn);
    expect(persistence.save).toHaveBeenCalledWith(tokens);
    expect(res.accountLabel).toBe('a@b.com');
  });

  test('does NOT report connected when the token cannot be persisted', async () => {
    const persistence = makePersistence();
    persistence.save.mockRejectedValueOnce(new FileSyncError('keychain denied', 'AUTH_FAILED'));
    await expect(
      connectGoogleDrive({
        clientId: 'cid',
        fetchFn: vi.fn() as unknown as FetchFn,
        persistence,
        runOAuth: async () => tokens,
      }),
    ).rejects.toThrow(/keychain denied/);
  });

  test('account label is best-effort: null when about.get fails, token still saved', async () => {
    const persistence = makePersistence();
    const fetchFn = vi.fn(async () => new Response('', { status: 500 }));
    const res = await connectGoogleDrive({
      clientId: 'cid',
      fetchFn: fetchFn as unknown as FetchFn,
      persistence,
      runOAuth: async () => tokens,
    });
    expect(res.accountLabel).toBeNull();
    expect(persistence.save).toHaveBeenCalledWith(tokens);
  });
});

describe('disconnectGoogleDrive', () => {
  test('clears the stored token', async () => {
    const persistence = makePersistence();
    await disconnectGoogleDrive(persistence);
    expect(persistence.clear).toHaveBeenCalledTimes(1);
  });
});
