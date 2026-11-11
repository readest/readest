import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']!);
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64']!);

// supabase-js persists the session under a key derived from the URL's first
// host label. Readest Cloud keeps the key from its original host so moving the
// client to another of its hosts doesn't sign everyone out.
const READEST_CLOUD_HOSTS = [
  'readest.supabase.co',
  'vbsyxfusjjqdxkjqlysc.supabase.co',
  'auth.readest.com',
];

// Some ISPs block *.supabase.co (#6416), so Readest Cloud sends password sign-in
// and the calls that keep such a session alive through a Worker on readest.com
// (workers/auth-proxy). OAuth and email links stay on the Supabase host: their
// callbacks land there, and a proxy can't change that.
const AUTH_PROXY_URL = 'https://auth-cf.readest.com';

const isProxiedAuthRequest = ({ pathname, searchParams }: URL) =>
  pathname === '/auth/v1/logout' ||
  (pathname === '/auth/v1/token' &&
    ['password', 'refresh_token'].includes(searchParams.get('grant_type') ?? ''));

const proxyAuthFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  return isProxiedAuthRequest(url)
    ? fetch(`${AUTH_PROXY_URL}${url.pathname}${url.search}`, init)
    : fetch(input, init);
};

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  READEST_CLOUD_HOSTS.includes(new URL(supabaseUrl).hostname)
    ? { auth: { storageKey: 'sb-readest-auth-token' }, global: { fetch: proxyAuthFetch } }
    : undefined,
);

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
