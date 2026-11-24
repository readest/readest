// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookOrbitSettings } from '@/types/settings';

const h = vi.hoisted(() => ({ bookorbit: undefined as Partial<BookOrbitSettings> | undefined }));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { bookorbit: h.bookorbit } }) },
}));

const { createBookOrbitClient } = await import('@/services/bookorbit/createClient');

beforeEach(() => {
  h.bookorbit = { serverUrl: 'http://localhost:13381', username: 'admin', password: '' };
});

describe('createBookOrbitClient', () => {
  it('needs something to sign in with', () => {
    expect(createBookOrbitClient()).toBeNull();
  });

  // BookOrbit 3.8+ API keys sign the audiobook API in without a password (#7508).
  it('signs in with an API key alone', () => {
    h.bookorbit = { ...h.bookorbit, apiKey: 'bok_key' };

    const client = createBookOrbitClient();

    expect(client?.accessToken).toBe('bok_key');
  });
});
