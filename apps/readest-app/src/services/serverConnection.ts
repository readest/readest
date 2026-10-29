import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ReadestRuntimeConfig } from '@/services/runtimeConfig';
import { type ServerConfigOverrides, validateStoredServerConfig } from '@/services/serverConfig';

const CONNECT_TIMEOUT_MS = 10_000;

export type ServerTestError =
  | 'outdated'
  | 'disabled'
  | 'unreachable'
  | 'not-readest'
  | 'incomplete'
  | 'auth-unreachable';

export type ServerTestResult =
  | { ok: true; config: ReadestRuntimeConfig; authHost: string; authHostDiffers: boolean }
  | { ok: false; error: ServerTestError; authHost?: string };

const get = (url: string) =>
  tauriFetch(url, { method: 'GET', connectTimeout: CONNECT_TIMEOUT_MS } as RequestInit);

/**
 * Checks a server before the user may save it: its public runtime config
 * (which also proves its API answers) and the Supabase auth service that
 * config points at. Never writes anything. `url` is a normalized origin.
 */
export const testServer = async (
  url: string,
  overrides?: ServerConfigOverrides,
): Promise<ServerTestResult> => {
  let res: Response;
  try {
    res = await get(`${url}/api/runtime-config`);
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  if (res.status === 404) return { ok: false, error: 'outdated' };
  if (res.status === 403) return { ok: false, error: 'disabled' };
  if (!res.ok) return { ok: false, error: 'unreachable' };

  let config: unknown;
  try {
    config = await res.json();
  } catch {
    return { ok: false, error: 'not-readest' };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, error: 'not-readest' };
  }

  const merged: ReadestRuntimeConfig = { ...config, ...overrides };
  if (!merged.supabaseUrl || !merged.supabaseAnonKey) return { ok: false, error: 'incomplete' };
  const candidate = { v: 1, serverUrl: url, config, overrides, savedAt: 0 };
  if (!overrides) delete candidate.overrides;
  if (!validateStoredServerConfig(candidate)) return { ok: false, error: 'not-readest' };

  const authHost = new URL(merged.supabaseUrl).host;
  try {
    const health = await get(`${merged.supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`);
    if (!health.ok) return { ok: false, error: 'auth-unreachable', authHost };
  } catch {
    return { ok: false, error: 'auth-unreachable', authHost };
  }

  return {
    ok: true,
    config: config as ReadestRuntimeConfig,
    authHost,
    authHostDiffers: authHost !== new URL(url).host,
  };
};
