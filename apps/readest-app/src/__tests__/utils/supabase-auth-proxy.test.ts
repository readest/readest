// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLOUD_URL = 'https://vbsyxfusjjqdxkjqlysc.supabase.co';
const PROXY_URL = 'https://auth-cf.readest.com';

const fetchMock = vi.fn<typeof fetch>();

const session = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: { id: 'user', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
};

const loadClient = async (url: string) => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  const { supabase } = await import('@/utils/supabase');
  return supabase;
};

const requestedUrls = () => fetchMock.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(session), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Readest Cloud auth routing (#6416)', () => {
  it('sends the password sign-in through the proxy', async () => {
    const supabase = await loadClient(CLOUD_URL);

    const { error } = await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });

    expect(error).toBeNull();
    expect(requestedUrls()).toEqual([`${PROXY_URL}/auth/v1/token?grant_type=password`]);
  });

  it('refreshes the session through the proxy', async () => {
    const supabase = await loadClient(CLOUD_URL);
    await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });
    fetchMock.mockClear();

    await supabase.auth.refreshSession();

    expect(requestedUrls()).toEqual([`${PROXY_URL}/auth/v1/token?grant_type=refresh_token`]);
  });

  // A network that blocks the proxy host must not stop the session refreshing
  // (#7538): the refresh then goes to the Supabase host, as before the proxy.
  it('refreshes on the Supabase host when the proxy cannot be reached', async () => {
    const supabase = await loadClient(CLOUD_URL);
    await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).origin === PROXY_URL) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ...session, access_token: 'access-2' }), {
        status: 200,
      });
    });

    // Fake timers run out the SDK's retries if the refresh keeps failing.
    vi.useFakeTimers();
    const refresh = supabase.auth.refreshSession();
    await vi.advanceTimersByTimeAsync(35_000);
    const { data, error } = await refresh;
    vi.useRealTimers();

    expect(error).toBeNull();
    expect(data.session?.access_token).toBe('access-2');
    expect(requestedUrls()).toEqual([
      `${PROXY_URL}/auth/v1/token?grant_type=refresh_token`,
      `${CLOUD_URL}/auth/v1/token?grant_type=refresh_token`,
    ]);
  });

  it('keeps the proxy answer when the proxy can be reached', async () => {
    const supabase = await loadClient(CLOUD_URL);
    await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () =>
      Response.json({ code: 'refresh_token_not_found', message: 'Invalid' }, { status: 400 }),
    );

    const { error } = await supabase.auth.refreshSession();

    expect(error?.status).toBe(400);
    expect(requestedUrls()).toEqual([`${PROXY_URL}/auth/v1/token?grant_type=refresh_token`]);
  });

  it('signs out through the proxy so a blocked network can drop the session', async () => {
    const supabase = await loadClient(CLOUD_URL);
    await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));

    await supabase.auth.signOut({ scope: 'local' });

    expect(requestedUrls()).toEqual([`${PROXY_URL}/auth/v1/logout?scope=local`]);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('keeps every other auth call on the Supabase host', async () => {
    const supabase = await loadClient(CLOUD_URL);

    await supabase.auth.signInWithOtp({ email: 'a@b.c' });
    await supabase.auth.signUp({ email: 'a@b.c', password: 'pw' });
    await supabase.auth.resetPasswordForEmail('a@b.c');
    await supabase.auth.signInWithIdToken({ provider: 'apple', token: 'id-token' });

    const urls = requestedUrls();
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url.startsWith(`${CLOUD_URL}/auth/v1/`)).toBe(true);
    }
  });

  it('keeps OAuth on the Supabase host, where its callback lands', async () => {
    const supabase = await loadClient(CLOUD_URL);

    const { data } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { skipBrowserRedirect: true },
    });

    expect(data.url?.startsWith(`${CLOUD_URL}/auth/v1/authorize`)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never sends a self-hosted instance password to the Readest proxy', async () => {
    const selfHosted = 'https://supabase.example.org';
    const supabase = await loadClient(selfHosted);

    await supabase.auth.signInWithPassword({ email: 'a@b.c', password: 'pw' });

    expect(requestedUrls()).toEqual([`${selfHosted}/auth/v1/token?grant_type=password`]);
  });
});
