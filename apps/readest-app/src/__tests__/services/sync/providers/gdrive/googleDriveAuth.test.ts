import { describe, expect, test, vi } from 'vitest';
import { resolveGoogleAccountLabel } from '@/services/sync/providers/gdrive/googleDriveAuth';
import type { FetchFn } from '@/services/sync/providers/oauth/tokenEndpoint';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('resolveGoogleAccountLabel', () => {
  test('returns the email address from about.get', async () => {
    const fetchFn = vi.fn(async () =>
      json({ user: { emailAddress: 'a@b.com', displayName: 'A B' } }),
    ) as unknown as FetchFn;
    expect(await resolveGoogleAccountLabel('AT', fetchFn)).toBe('a@b.com');
  });

  test('falls back to the display name when emailAddress is absent', async () => {
    const fetchFn = vi.fn(async () => json({ user: { displayName: 'A B' } })) as unknown as FetchFn;
    expect(await resolveGoogleAccountLabel('AT', fetchFn)).toBe('A B');
  });

  test('returns null on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => json({}, 500)) as unknown as FetchFn;
    expect(await resolveGoogleAccountLabel('AT', fetchFn)).toBeNull();
  });

  test('sends the access token as a bearer header against the about.get URL', async () => {
    const fetchFn = vi.fn(async () => json({ user: {} })) as unknown as FetchFn;
    await resolveGoogleAccountLabel('AT', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/about'),
      expect.objectContaining({ headers: { Authorization: 'Bearer AT' } }),
    );
  });
});
