import { afterEach, describe, expect, it, vi } from 'vitest';

const loadStorageKey = async (url?: string) => {
  vi.resetModules();
  if (url) vi.stubEnv('SUPABASE_URL', url);
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  const { supabase } = await import('@/utils/supabase');
  return (supabase.auth as unknown as { storageKey: string }).storageKey;
};

describe('supabase session storage key', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the Readest Cloud project URL', () => {
    expect(atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']!)).toBe(
      'https://vbsyxfusjjqdxkjqlysc.supabase.co',
    );
  });

  it.each([
    'https://readest.supabase.co',
    'https://vbsyxfusjjqdxkjqlysc.supabase.co',
    'https://auth.readest.com',
  ])('keeps the original session key for Readest Cloud at %s', async (url) => {
    expect(await loadStorageKey(url)).toBe('sb-readest-auth-token');
  });

  it('keeps the host-derived key for a self-hosted instance', async () => {
    expect(await loadStorageKey('http://localhost:54321')).toBe('sb-localhost-auth-token');
  });
});
