export interface ReadestRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  objectStorageType?: string;
  storageFixedQuota?: number;
  translationFixedQuota?: number;
}

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
  objectStorageType: process.env['OBJECT_STORAGE_TYPE'] ?? process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'],
  storageFixedQuota: (() => {
    const raw = process.env['STORAGE_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_STORAGE_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  translationFixedQuota: (() => {
    const raw = process.env['TRANSLATION_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
});
