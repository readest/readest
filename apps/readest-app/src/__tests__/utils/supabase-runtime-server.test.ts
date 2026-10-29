import { afterEach, describe, expect, it, vi } from 'vitest';

// A server saved at runtime (installed as window.__READEST_RUNTIME_CONFIG by
// the Tauri bootstrap script) must win over values baked in at build time, at
// the moment the Supabase client is created on import.
describe('supabase client with a runtime server', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__READEST_RUNTIME_CONFIG;
  });

  it('uses the runtime server over baked NEXT_PUBLIC_* values', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://baked.example.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'baked-key');
    window.__READEST_RUNTIME_CONFIG = {
      supabaseUrl: 'https://books.example.com',
      supabaseAnonKey: 'runtime-key',
    };
    const { supabase } = await import('@/utils/supabase');
    const client = supabase as unknown as { supabaseUrl: string; supabaseKey: string };
    expect(client.supabaseUrl).toBe('https://books.example.com');
    expect(client.supabaseKey).toBe('runtime-key');
  });
});
