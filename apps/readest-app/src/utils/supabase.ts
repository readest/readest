import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig, getSelfHostedLocalConfig } from '@/services/runtimeConfig';

// getSelfHostedLocalConfig() is read once at module-evaluation time so the
// client is always initialized with a consistent URL for the lifetime of the
// page. Tauri builds have no server-side runtime-config injection, so the
// localStorage value is the only way to configure a self-hosted instance
// without rebuilding the app. A restart is required when the value changes.
const selfHostedConfig = getSelfHostedLocalConfig();

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  selfHostedConfig?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']!);
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  selfHostedConfig?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64']!);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
