import { PUBLIC_RUNTIME_CONFIG_KEYS, type ReadestRuntimeConfig } from '@/services/runtimeConfig';

/**
 * The server the native app talks to, chosen at runtime (Readest Cloud when
 * absent). Stored in the webview's localStorage because it must be readable
 * synchronously by the inline bootstrap script, before any module that reads
 * the runtime config at import time (the Supabase client, frozen API URLs)
 * evaluates. Everything in it is public: the server serves the same values
 * unauthenticated from `/api/runtime-config`.
 */
export const SERVER_CONFIG_STORAGE_KEY = 'readest.server';

export interface ServerConfigOverrides {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface StoredServerConfig {
  v: 1;
  /** Origin the user entered, e.g. `https://books.example.com`. */
  serverUrl: string;
  /** Advanced overrides for deployments that run auth on a separate host. */
  overrides?: ServerConfigOverrides;
  /** The server's `/api/runtime-config` response at the time it was saved. */
  config: ReadestRuntimeConfig;
  savedAt: number;
}

type KeyTypes = Record<string, 'url' | 'string' | 'number' | 'boolean'>;

declare global {
  interface Window {
    __READEST_SERVER_CONFIG_INVALID?: boolean;
  }
}

/**
 * Validates an untrusted value as a {@link StoredServerConfig}: known version,
 * only allowlisted keys of the right type, parseable http(s) URLs, and a
 * usable Supabase URL and anon key once overrides are applied.
 *
 * MUST stay self-contained (no references outside its own body, no optional
 * chaining) - it is serialized with `toString()` into the inline bootstrap
 * script, where nothing else from this module exists.
 */
export function parseStoredServerConfig(
  raw: unknown,
  keyTypes: KeyTypes,
): StoredServerConfig | null {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const isHttpUrl = (value: unknown): boolean => {
    if (typeof value !== 'string' || !value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  };
  const checkValue = (type: string, value: unknown): boolean => {
    if (type === 'url') return isHttpUrl(value);
    if (type === 'string') return typeof value === 'string' && value.length > 0;
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'boolean') return typeof value === 'boolean';
    return false;
  };

  if (!isObject(raw)) return null;
  if (raw['v'] !== 1) return null;
  if (!isHttpUrl(raw['serverUrl'])) return null;
  if (typeof raw['savedAt'] !== 'number') return null;
  for (const key of Object.keys(raw)) {
    if (['v', 'serverUrl', 'overrides', 'config', 'savedAt'].indexOf(key) === -1) return null;
  }

  const config = raw['config'];
  if (!isObject(config)) return null;
  for (const key of Object.keys(config)) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs Chrome 93; this runs unpolyfilled
    if (!Object.prototype.hasOwnProperty.call(keyTypes, key)) return null;
    if (!checkValue(keyTypes[key] as string, config[key])) return null;
  }

  const overrides = raw['overrides'];
  if (overrides !== undefined) {
    if (!isObject(overrides)) return null;
    for (const key of Object.keys(overrides)) {
      if (key !== 'supabaseUrl' && key !== 'supabaseAnonKey') return null;
      if (!checkValue(keyTypes[key] as string, overrides[key])) return null;
    }
  }

  const merged = Object.assign({}, config, overrides || {});
  if (!isHttpUrl(merged['supabaseUrl'])) return null;
  if (typeof merged['supabaseAnonKey'] !== 'string' || !merged['supabaseAnonKey']) return null;

  return raw as unknown as StoredServerConfig;
}

/**
 * Installs the stored server config as `window.__READEST_RUNTIME_CONFIG`.
 * Runs as an inline `<head>` script on Tauri builds, before the app bundle.
 * An entry that fails validation is not installed; the app then starts on its
 * default server and a client hook clears the entry and tells the user.
 *
 * MUST stay self-contained - see {@link parseStoredServerConfig}.
 */
export function bootstrapStoredServerConfig(
  parse: typeof parseStoredServerConfig,
  storageKey: string,
  keyTypes: KeyTypes,
): void {
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(storageKey);
  } catch {
    // Storage unavailable: behave as if no server was saved.
    return;
  }
  if (!text) return;
  let stored: StoredServerConfig | null = null;
  try {
    stored = parse(JSON.parse(text), keyTypes);
  } catch {
    stored = null;
  }
  if (!stored) {
    window.__READEST_SERVER_CONFIG_INVALID = true;
    return;
  }
  window.__READEST_RUNTIME_CONFIG = Object.assign({}, stored.config, stored.overrides || {});
}

/** Source of the inline bootstrap script injected on Tauri builds. */
export const getServerConfigBootstrapScript = (): string =>
  `(${bootstrapStoredServerConfig.toString()})(${parseStoredServerConfig.toString()},${JSON.stringify(
    SERVER_CONFIG_STORAGE_KEY,
  )},${JSON.stringify(PUBLIC_RUNTIME_CONFIG_KEYS)});`;

export const validateStoredServerConfig = (raw: unknown): StoredServerConfig | null =>
  parseStoredServerConfig(raw, PUBLIC_RUNTIME_CONFIG_KEYS);

/** The runtime config a stored server choice resolves to. */
export const resolveStoredRuntimeConfig = (stored: StoredServerConfig): ReadestRuntimeConfig => ({
  ...stored.config,
  ...(stored.overrides ?? {}),
});

export const readStoredServerConfig = (): StoredServerConfig | null => {
  try {
    const text = localStorage.getItem(SERVER_CONFIG_STORAGE_KEY);
    return text ? validateStoredServerConfig(JSON.parse(text)) : null;
  } catch {
    return null;
  }
};

export const writeStoredServerConfig = (stored: StoredServerConfig): void => {
  if (!validateStoredServerConfig(stored)) {
    throw new Error('Refusing to store an invalid server config');
  }
  localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(stored));
};

export const clearStoredServerConfig = (): void => {
  try {
    localStorage.removeItem(SERVER_CONFIG_STORAGE_KEY);
  } catch {}
};

export type ServerUrlError = 'invalid' | 'insecure';

/**
 * Reduces user input to a server origin. `https:` is accepted as-is; `http:`
 * only once the user has acknowledged the unencrypted-connection warning.
 */
export const normalizeServerUrl = (
  input: string,
  { allowHttp = false }: { allowHttp?: boolean } = {},
): { url: string } | { error: ServerUrlError } => {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: 'invalid' };
  }
  if (!url.hostname || /\s/.test(trimmed)) return { error: 'invalid' };
  if (url.protocol === 'http:') {
    if (!allowHttp) return { error: 'insecure' };
  } else if (url.protocol !== 'https:') {
    return { error: 'invalid' };
  }
  return { url: url.origin };
};
