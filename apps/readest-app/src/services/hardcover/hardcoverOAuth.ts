import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import {
  postForm,
  refreshAccessToken,
  requestTokens,
  TokenEndpointError,
  type FetchFn,
  type TokenSet,
} from '@/services/sync/providers/oauth/tokenEndpoint';

// Public client (no secret): safe to ship.
export const HARDCOVER_OAUTH_CLIENT_ID = 'd5a1461f-073a-43c2-80c1-db784fa92a06';
const SCOPE = 'read:catalog read:library write:library read:me:content';

const OAUTH_BASE = 'https://api.hardcover.app/oauth2';
const TOKEN_ENDPOINT = `${OAUTH_BASE}/token`;
const DEVICE_ENDPOINT = `${OAUTH_BASE}/device`;
const REVOKE_ENDPOINT = `${OAUTH_BASE}/revoke`;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SLOW_DOWN_STEP_SEC = 5;
const MAX_TRANSIENT_POLL_FAILURES = 3;

export interface DeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export class HardcoverOAuthError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const platformFetch: FetchFn = (input, init) =>
  isTauriAppPlatform() ? tauriFetch(input, init) : window.fetch(input, init);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const startDeviceAuth = async (): Promise<DeviceAuth> => {
  const res = await postForm(
    DEVICE_ENDPOINT,
    new URLSearchParams({ client_id: HARDCOVER_OAUTH_CLIENT_ID, scope: SCOPE }),
    platformFetch,
  );
  if (!res.ok) throw new HardcoverOAuthError('device_request_failed', `HTTP ${res.status}`);
  const d = await res.json();
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    verificationUriComplete: d.verification_uri_complete,
    expiresIn: d.expires_in ?? 900,
    interval: d.interval ?? 5,
  };
};

interface PollOptions {
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Polls until approved. Throws HardcoverOAuthError for denied/expired/timeout/aborted. */
export const pollDeviceToken = async (
  device: DeviceAuth,
  { signal, sleep: wait = sleep, now = Date.now }: PollOptions = {},
): Promise<TokenSet> => {
  const deadline = now() + device.expiresIn * 1000;
  const params = new URLSearchParams({
    grant_type: DEVICE_GRANT,
    device_code: device.deviceCode,
    client_id: HARDCOVER_OAUTH_CLIENT_ID,
  });
  let interval = device.interval;
  let failures = 0;
  while (now() < deadline) {
    await wait(interval * 1000);
    if (signal?.aborted) throw new HardcoverOAuthError('aborted');
    try {
      return await requestTokens(TOKEN_ENDPOINT, params, 'device', platformFetch);
    } catch (error) {
      // A network blip or 5xx shouldn't end the flow; give up after a few in a row.
      if (!(error instanceof TokenEndpointError) || error.status >= 500) {
        if (++failures < MAX_TRANSIENT_POLL_FAILURES) continue;
        if (error instanceof TokenEndpointError) throw new HardcoverOAuthError('server_error');
        throw error;
      }
      failures = 0;
      if (error.code === 'slow_down') interval += SLOW_DOWN_STEP_SEC;
      else if (error.code !== 'authorization_pending') {
        throw new HardcoverOAuthError(error.code ?? 'unknown', error.message);
      }
    }
  }
  throw new HardcoverOAuthError('expired_token');
};

// Clients are short-lived and built per sync, so concurrent pushes would each spend the
// same (possibly rotating) refresh token; share one in-flight refresh per token.
const refreshing = new Map<string, Promise<TokenSet>>();

/** Refreshes, keeping the old refresh token when the server doesn't rotate it. */
export const refreshHardcoverTokens = (tokens: TokenSet): Promise<TokenSet> => {
  const { refreshToken } = tokens;
  if (!refreshToken) return Promise.reject(new HardcoverOAuthError('no_refresh_token'));
  let pending = refreshing.get(refreshToken);
  if (!pending) {
    pending = refreshAccessToken(
      { refreshToken, clientId: HARDCOVER_OAUTH_CLIENT_ID, tokenEndpoint: TOKEN_ENDPOINT },
      platformFetch,
    )
      .then((t) => ({ ...t, refreshToken: t.refreshToken ?? refreshToken }))
      .finally(() => refreshing.delete(refreshToken));
    refreshing.set(refreshToken, pending);
  }
  return pending;
};

/** Best-effort: revoking the refresh token also revokes the access token. */
export const revokeHardcoverTokens = async (tokens: TokenSet): Promise<void> => {
  try {
    await postForm(
      REVOKE_ENDPOINT,
      new URLSearchParams({
        token: tokens.refreshToken ?? tokens.accessToken,
        token_type_hint: tokens.refreshToken ? 'refresh_token' : 'access_token',
        client_id: HARDCOVER_OAUTH_CLIENT_ID,
      }),
      platformFetch,
    );
  } catch {
    // Signing out locally must not depend on the network.
  }
};
