import { getAPIBaseUrl } from '@/services/environment';

// Sign-in with a code (an OAuth device authorization grant), as KOReader's
// Readest > Sign in with a code does it: the app shows a code, a device signed
// in to Readest approves it on /link, and the app's next ask gets a session.

/** A code to show, from /auth/device/code. */
export interface SignInCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface SignInSession {
  access_token: string;
  refresh_token: string;
}

export class CodeSignInError extends Error {
  constructor(readonly code: 'request_failed' | 'expired_token' | 'aborted') {
    super(code);
    this.name = 'CodeSignInError';
  }
}

export const requestSignInCode = async (): Promise<SignInCode> => {
  const res = await fetch(`${getAPIBaseUrl()}/auth/device/code`, { method: 'POST' });
  const d = await res.json().catch(() => null);
  if (!res.ok || typeof d?.device_code !== 'string') throw new CodeSignInError('request_failed');
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    verificationUriComplete: d.verification_uri_complete,
    expiresIn: d.expires_in,
    interval: d.interval,
  };
};

interface PollOptions {
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Asks for the session every `interval` seconds until the code is approved.
 * Network and server errors only skip an ask, like the plugin: the reader may
 * be on flaky Wi-Fi while its owner approves.
 */
export const pollSignInSession = async (
  code: SignInCode,
  {
    signal,
    sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    now = Date.now,
  }: PollOptions = {},
): Promise<SignInSession> => {
  const deadline = now() + code.expiresIn * 1000;
  for (;;) {
    await sleep(code.interval * 1000);
    if (signal?.aborted) throw new CodeSignInError('aborted');
    if (now() >= deadline) throw new CodeSignInError('expired_token');
    const ask = fetch(`${getAPIBaseUrl()}/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: code.deviceCode, grant: 'session' }),
    })
      .then((res) => res.json())
      .catch(() => null);
    // An ask that never answers (a stalled connection) gives up when the code expires, so
    // the view can offer a new one.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((r) => {
      timer = setTimeout(() => r(null), Math.max(0, deadline - now()));
    });
    const body = await Promise.race([ask, expiry]);
    clearTimeout(timer);
    if (signal?.aborted) throw new CodeSignInError('aborted');
    if (body?.access_token && body?.refresh_token) {
      return { access_token: body.access_token, refresh_token: body.refresh_token };
    }
    if (body?.error === 'expired_token') throw new CodeSignInError('expired_token');
  }
};
