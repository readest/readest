import { describe, expect, test, vi } from 'vitest';
import { WebDriveAuth } from '@/services/sync/providers/gdrive/WebDriveAuth';
import { FileSyncError } from '@/services/sync/file/provider';
import type { FetchFn } from '@/services/sync/providers/gdrive/GoogleDriveProvider';
import type { TokenSet } from '@/services/sync/providers/gdrive/auth/tokenStore';

const fetchStub = vi.fn(async () => new Response('{}')) as unknown as FetchFn;
const token = (overrides: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: 'AT',
  expiresAt: 10_000,
  ...overrides,
});

describe('WebDriveAuth', () => {
  test('returns the stored access token while it is valid', async () => {
    const auth = new WebDriveAuth(
      fetchStub,
      () => token({ expiresAt: 10_000 }),
      () => 0,
    );
    expect(await auth.getAccessToken()).toBe('AT');
  });

  test('throws AUTH_FAILED when the stored token has expired', async () => {
    const auth = new WebDriveAuth(
      fetchStub,
      () => token({ expiresAt: 1_000 }),
      () => 5_000,
    );
    const err = await auth.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileSyncError);
    expect((err as FileSyncError).code).toBe('AUTH_FAILED');
  });

  test('throws AUTH_FAILED when there is no stored token (needs reconnect)', async () => {
    const auth = new WebDriveAuth(
      fetchStub,
      () => null,
      () => 0,
    );
    const err = await auth.getAccessToken().catch((e: unknown) => e);
    expect((err as FileSyncError).code).toBe('AUTH_FAILED');
  });

  test('accountLabel reads the email from about.get', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { emailAddress: 'me@example.com' } }), { status: 200 }),
    ) as unknown as FetchFn;
    const auth = new WebDriveAuth(
      fetchFn,
      () => token(),
      () => 0,
    );
    expect(await auth.accountLabel()).toBe('me@example.com');
  });
});
