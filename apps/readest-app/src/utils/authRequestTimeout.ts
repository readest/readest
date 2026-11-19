// supabase-js sends auth requests without a time limit. A request that never gets
// an answer, such as one sent on a connection that died while the device slept,
// keeps refreshSession() and signOut() waiting for good, and every later refresh
// waits on that same request. Failing it after a while lets auth-js retry the
// refresh with a new request.
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

// Matches the auth API under any base path, e.g. a self-hosted
// https://example.com/supabase/auth/v1/token.
const isAuthRequest = ({ pathname }: URL) => pathname.includes('/auth/v1/');

export const withAuthRequestTimeout =
  (fetchImpl: typeof fetch): typeof fetch =>
  async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    if (!isAuthRequest(new URL(request?.url ?? (input as string | URL)))) {
      return fetchImpl(input, init);
    }

    const controller = new AbortController();
    const callerSignal = init?.signal ?? request?.signal;
    const abortWithCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortWithCaller();
    else callerSignal?.addEventListener('abort', abortWithCaller, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('The auth request timed out', 'TimeoutError')),
      AUTH_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      // fetch() resolves once the headers arrive and auth-js reads the body after
      // that, so wait for the body within the same limit.
      await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortWithCaller);
    }
  };
