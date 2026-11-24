import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { AUTH_REQUEST_TIMEOUT_MS, withAuthRequestTimeout } from '@/utils/authRequestTimeout';

// A request that never gets an answer and only ends when a signal aborts it
// after the call: the signal in init or, failing that, the Request's own.
const unanswered = (input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

// An answer whose headers arrive but whose body stops halfway. Like fetch(),
// aborting the signal errors the body.
const stalledBody = async (_input: RequestInfo | URL, init?: RequestInit) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"access_token":'));
        init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

const settled = (promise: Promise<unknown>) => {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withAuthRequestTimeout', () => {
  it('fails an auth request that gets no answer', async () => {
    const request = withAuthRequestTimeout(unanswered)(
      'https://auth.example.test/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' },
    );
    const isSettled = settled(request);

    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(isSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isSettled(), 'the request ends at the time limit').toBe(true);
    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('fails an auth request whose body stops arriving', async () => {
    const request = withAuthRequestTimeout(stalledBody)(
      'https://auth.example.test/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' },
    );
    const isSettled = settled(request);

    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    expect(isSettled(), 'the request ends at the time limit').toBe(true);
    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('fails an auth request under a base path', async () => {
    const request = withAuthRequestTimeout(unanswered)(
      'https://reader.example.test/backend/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' },
    );
    const isSettled = settled(request);

    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    expect(isSettled(), 'the request ends at the time limit').toBe(true);
    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('passes other requests through unchanged', async () => {
    const inner = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    const init = { method: 'GET' };

    await withAuthRequestTimeout(inner)('https://auth.example.test/rest/v1/books', init);

    expect(inner).toHaveBeenCalledWith('https://auth.example.test/rest/v1/books', init);
  });

  it("aborts with the caller's signal", async () => {
    const caller = new AbortController();
    const request = withAuthRequestTimeout(unanswered)(
      new URL('https://auth.example.test/auth/v1/logout'),
      { method: 'POST', signal: caller.signal },
    );

    caller.abort(new Error('closed'));

    await expect(request).rejects.toThrow('closed');
  });

  it("aborts with the signal of the caller's Request", async () => {
    const caller = new AbortController();
    const request = withAuthRequestTimeout(unanswered)(
      new Request('https://auth.example.test/auth/v1/logout', {
        method: 'POST',
        signal: caller.signal,
      }),
    );
    const isSettled = settled(request);

    caller.abort(new Error('closed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(isSettled(), "the request ends when the caller's Request aborts").toBe(true);
    await expect(request).rejects.toThrow('closed');
  });

  it('lets a stalled session refresh give up instead of waiting forever', async () => {
    const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated' };
    const authFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.searchParams.get('grant_type') === 'password') {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        });
      }
      return unanswered(input, init);
    });
    const supabase = createClient('https://auth.example.test', 'test-anon-key', {
      global: { fetch: withAuthRequestTimeout(authFetch) },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'auth-request-timeout-test',
      },
    });
    await supabase.auth.signInWithPassword({ email: 'reader@example.test', password: 'pw' });

    const refresh = supabase.auth.refreshSession();
    const isSettled = settled(refresh);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isSettled(), 'the refresh gives up within a minute').toBe(true);
    const { error } = await refresh;

    expect(error?.name).toBe('AuthRetryableFetchError');
    localStorage.removeItem('auth-request-timeout-test');
  });
});
