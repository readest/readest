import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env['NEXT_PUBLIC_DEV_SUPABASE_URL']!;
const supabaseAnonKey =
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env['NEXT_PUBLIC_DEV_SUPABASE_ANON_KEY']!;

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
