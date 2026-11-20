import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from '@/app/runtime-config.js/route';
import { getRuntimeConfig } from '@/services/runtimeConfig';

// What a page load does with the script the route serves.
const runConfigScript = async () => new Function(await GET().text())();

beforeEach(() => {
  delete window.__READEST_RUNTIME_CONFIG;
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
});

describe('runtime config on a cached page load', () => {
  // A web build's cached chunks can run before /runtime-config.js, and modules
  // such as utils/supabase.ts read the config as they load. They fell back to
  // the build's defaults: Readest Cloud instead of the server's own Supabase.
  test('a module that loads before the script gets the config the last load saved', async () => {
    vi.stubEnv('SUPABASE_PUBLIC_URL', 'https://supabase.self-hosted.test');
    await runConfigScript();
    // The next page load, before its /runtime-config.js has run.
    delete window.__READEST_RUNTIME_CONFIG;

    expect(getRuntimeConfig()?.supabaseUrl, "the server's Supabase URL").toBe(
      'https://supabase.self-hosted.test',
    );
  });

  test("the script's config wins once it runs", async () => {
    vi.stubEnv('SUPABASE_PUBLIC_URL', 'https://old.self-hosted.test');
    await runConfigScript();
    vi.stubEnv('SUPABASE_PUBLIC_URL', 'https://new.self-hosted.test');
    await runConfigScript();

    expect(getRuntimeConfig()?.supabaseUrl).toBe('https://new.self-hosted.test');
  });

  // The Tauri build is a static export with no /runtime-config.js.
  test('the Tauri build reads no saved config', () => {
    localStorage.setItem(
      'readest-runtime-config',
      JSON.stringify({ supabaseUrl: 'https://supabase.self-hosted.test' }),
    );
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');

    expect(getRuntimeConfig()).toBeUndefined();
  });
});
