import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * Sign in with a QR code: the sign-in page shows a code and its QR code, and
 * signs in once a phone or computer signed in to Readest approves it on /link,
 * the way KOReader's Readest > Sign in with a code does. No password is typed
 * and no browser opens, so it suits e-ink readers and shared screens.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, string>) =>
    opts ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => opts[name] ?? _m) : key,
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { alt, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={String(alt ?? '')} {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

vi.mock('@/app/auth/components/ReadestCloudOptIn', () => ({ default: () => null }));

import AuthPanel from '@/app/auth/components/AuthPanel';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const deviceCode = (userCode: string) => ({
  device_code: `secret-${userCode}`,
  user_code: userCode,
  verification_uri: 'https://web.readest.com/link',
  verification_uri_complete: `https://web.readest.com/link?code=${userCode}`,
  expires_in: 600,
  // Seconds; a few milliseconds between asks keeps the test quick.
  interval: 0.005,
});

const session = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  expires_at: 1,
  token_type: 'bearer',
  user: { id: 'u1', email: 'reader@example.com', user_metadata: {} },
};

const renderPanel = () => {
  const setSession = vi.fn(async () => ({ data: {}, error: null }));
  const supabaseClient = { auth: { setSession } } as unknown as SupabaseClient;
  render(<AuthPanel supabaseClient={supabaseClient} magicLink onProviderSignIn={vi.fn()} />);
  return { setSession };
};

/** Answers the code request with each of `codes` in turn, and token polls with `token`. */
const serve = (codes: string[], token: () => Response) => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/device/code')) return json(200, deviceCode(codes.shift()!));
    return token();
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthPanel: sign in with a QR code', () => {
  test('shows the code and its QR code, then signs in once the code is approved', async () => {
    let approved = false;
    serve(['BCDF-GHJK'], () =>
      approved ? json(200, session) : json(400, { error: 'authorization_pending' }),
    );
    const { setSession } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a QR code' }));

    expect(await screen.findByText('BCDF-GHJK')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'https://web.readest.com/link?code=BCDF-GHJK' }),
    ).toBeTruthy();
    // The email form gives way to the code while it is shown.
    expect(screen.queryByLabelText('Email address')).toBeNull();

    // Polls keep coming back pending until a signed-in device approves the code.
    await new Promise((r) => setTimeout(r, 30));
    expect(setSession).not.toHaveBeenCalled();
    approved = true;

    await waitFor(() =>
      expect(setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' }),
    );
  });

  test('offers a new code once the code expires', async () => {
    let expired = true;
    const fetch = serve(['BCDF-GHJK', 'LMNP-QRST'], () =>
      expired
        ? json(400, { error: 'expired_token' })
        : json(400, { error: 'authorization_pending' }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a QR code' }));

    expect(await screen.findByText('The code expired. Please try again.')).toBeTruthy();
    expect(screen.queryByText('BCDF-GHJK')).toBeNull();

    expired = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByText('LMNP-QRST')).toBeTruthy();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/device/code'))).toHaveLength(2);
  });

  test('says so when no code can be had', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a QR code' }));

    expect(
      await screen.findByText(
        'Unable to connect to Readest. Please check your network connection.',
      ),
    ).toBeTruthy();
  });

  test('Cancel goes back to the other sign-in methods and stops asking', async () => {
    const fetch = serve(['BCDF-GHJK'], () => json(400, { error: 'authorization_pending' }));
    const { setSession } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a QR code' }));
    await screen.findByText('BCDF-GHJK');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.queryByText('BCDF-GHJK')).toBeNull();
    const asked = fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(fetch.mock.calls.length).toBe(asked);
    expect(setSession).not.toHaveBeenCalled();
  });
});
