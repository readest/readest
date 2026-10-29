export interface ReadestRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  objectStorageType?: string;
  storageFixedQuota?: number;
  translationFixedQuota?: number;
  fontBaseUrl?: string;
  selfHosted?: boolean;
}

/**
 * Every runtime-config key, classified by the type a client may accept for
 * it. This is the allowlist for everything a server publishes about itself
 * (`/api/runtime-config`) and everything the native app will install from a
 * stored server choice: a key that is not listed here never leaves the server
 * and is rejected on the client. Typed as a complete record so adding a field
 * to `ReadestRuntimeConfig` without classifying it fails the type check.
 * Never add a server-only credential here.
 */
export const PUBLIC_RUNTIME_CONFIG_KEYS: Record<
  keyof ReadestRuntimeConfig,
  'url' | 'string' | 'number' | 'boolean'
> = {
  supabaseUrl: 'url',
  supabaseAnonKey: 'string',
  apiBaseUrl: 'url',
  objectStorageType: 'string',
  storageFixedQuota: 'number',
  translationFixedQuota: 'number',
  fontBaseUrl: 'url',
  selfHosted: 'boolean',
};

export const pickPublicRuntimeConfig = (config: ReadestRuntimeConfig): ReadestRuntimeConfig => {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(PUBLIC_RUNTIME_CONFIG_KEYS)) {
    const value = config[key as keyof ReadestRuntimeConfig];
    if (value !== undefined && value !== null && value !== '') picked[key] = value;
  }
  return picked as ReadestRuntimeConfig;
};

declare global {
  interface Window {
    __READEST_RUNTIME_CONFIG?: ReadestRuntimeConfig;
  }
}

export const getRuntimeConfig = () =>
  typeof window === 'undefined' ? undefined : window.__READEST_RUNTIME_CONFIG;

export const getServerRuntimeConfig = (): ReadestRuntimeConfig => ({
  // Browser runtime config should prefer a public Supabase URL when provided.
  // SUPABASE_URL remains as a backward-compatible fallback for non-split setups.
  supabaseUrl:
    process.env['SUPABASE_PUBLIC_URL'] ??
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
    process.env['SUPABASE_URL'],
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  apiBaseUrl:
    process.env['API_BASE_URL'] ??
    process.env['NEXT_PUBLIC_API_BASE_URL'] ??
    process.env['SITE_URL'],
  // These were previously baked as NEXT_PUBLIC_* build args; now read from runtime env so
  // the published image can be configured without rebuilding.
  objectStorageType:
    process.env['OBJECT_STORAGE_TYPE'] ?? process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'],
  // A self-hosted deployment unlocks every premium feature: there is no store
  // to buy from, and the operator already runs the infrastructure the paywall
  // funds.
  selfHosted:
    (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true' || undefined,
  storageFixedQuota: (() => {
    const raw =
      process.env['STORAGE_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_STORAGE_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  translationFixedQuota: (() => {
    const raw =
      process.env['TRANSLATION_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  // Base URL of the directory holding the self-hosted CJK webfont bundles.
  // Readest's own CDN only answers CORS for readest.com origins, so a
  // self-hosted deployment on a custom domain has to serve them itself (#5550).
  // `||` not `??`: compose passes the variable through even when it is unset,
  // and an empty string would build root-relative font URLs.
  fontBaseUrl:
    process.env['FONT_BASE_URL'] || process.env['NEXT_PUBLIC_FONT_BASE_URL'] || undefined,
});
