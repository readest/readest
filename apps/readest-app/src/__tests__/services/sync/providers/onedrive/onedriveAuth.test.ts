import { describe, expect, test } from 'vitest';
import { resolveOneDriveAccountLabel } from '@/services/sync/providers/onedrive/onedriveAuth';
import type { FetchFn } from '@/services/sync/providers/oauth/tokenEndpoint';

describe('resolveOneDriveAccountLabel', () => {
  test('reads userPrincipalName from /me, falling back to mail then displayName', async () => {
    const upn = (async () =>
      new Response(
        JSON.stringify({ userPrincipalName: 'a@b.com', mail: 'm@b.com', displayName: 'A' }),
        { status: 200 },
      )) as unknown as FetchFn;
    expect(await resolveOneDriveAccountLabel('T', upn)).toBe('a@b.com');
    const mailOnly = (async () =>
      new Response(JSON.stringify({ mail: 'm@b.com', displayName: 'A' }), {
        status: 200,
      })) as unknown as FetchFn;
    expect(await resolveOneDriveAccountLabel('T', mailOnly)).toBe('m@b.com');
  });
  test('returns null on a non-ok response', async () => {
    const fetchFn = (async () => new Response('', { status: 401 })) as unknown as FetchFn;
    expect(await resolveOneDriveAccountLabel('T', fetchFn)).toBeNull();
  });
});
