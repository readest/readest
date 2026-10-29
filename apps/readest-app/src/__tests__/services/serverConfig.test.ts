import { describe, test, expect, beforeEach } from 'vitest';
import {
  SERVER_CONFIG_STORAGE_KEY,
  type StoredServerConfig,
  getServerConfigBootstrapScript,
  normalizeServerUrl,
  readStoredServerConfig,
  resolveStoredRuntimeConfig,
  validateStoredServerConfig,
  writeStoredServerConfig,
} from '@/services/serverConfig';

const valid = (): StoredServerConfig => ({
  v: 1,
  serverUrl: 'https://books.example.com',
  config: {
    supabaseUrl: 'https://books.example.com',
    supabaseAnonKey: 'anon-key',
    apiBaseUrl: 'https://books.example.com',
    selfHosted: true,
    storageFixedQuota: 1024,
  },
  savedAt: 1,
});

const win = window as unknown as Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  delete win['__READEST_RUNTIME_CONFIG'];
  delete win['__READEST_SERVER_CONFIG_INVALID'];
});

describe('validateStoredServerConfig', () => {
  test('accepts a well-formed entry', () => {
    expect(validateStoredServerConfig(valid())).toEqual(valid());
  });

  test('rejects a non-object or an unknown version', () => {
    expect(validateStoredServerConfig(null)).toBeNull();
    expect(validateStoredServerConfig('x')).toBeNull();
    expect(validateStoredServerConfig({ ...valid(), v: 2 })).toBeNull();
  });

  test('rejects an unknown config key', () => {
    const entry = valid();
    (entry.config as Record<string, unknown>)['serviceRoleKey'] = 'secret';
    expect(validateStoredServerConfig(entry)).toBeNull();
  });

  test('rejects an unknown top-level key', () => {
    expect(validateStoredServerConfig({ ...valid(), extra: 1 })).toBeNull();
  });

  test('rejects a non-URL supabaseUrl', () => {
    const entry = valid();
    entry.config.supabaseUrl = 'not a url';
    expect(validateStoredServerConfig(entry)).toBeNull();
  });

  test('rejects a non-http URL', () => {
    const entry = valid();
    entry.config.apiBaseUrl = 'javascript:alert(1)';
    expect(validateStoredServerConfig(entry)).toBeNull();
  });

  test('rejects a wrongly typed value', () => {
    const entry = valid();
    (entry.config as Record<string, unknown>)['selfHosted'] = 'true';
    expect(validateStoredServerConfig(entry)).toBeNull();
  });

  test('rejects a missing anon key', () => {
    const entry = valid();
    delete entry.config.supabaseAnonKey;
    expect(validateStoredServerConfig(entry)).toBeNull();
  });

  test('accepts a missing anon key supplied by an override', () => {
    const entry = valid();
    delete entry.config.supabaseAnonKey;
    entry.overrides = { supabaseAnonKey: 'override-key' };
    expect(validateStoredServerConfig(entry)).not.toBeNull();
  });

  test('rejects an override for a non-auth key', () => {
    const entry = valid() as unknown as Record<string, unknown>;
    entry['overrides'] = { apiBaseUrl: 'https://elsewhere.example.com' };
    expect(validateStoredServerConfig(entry)).toBeNull();
  });
});

describe('resolveStoredRuntimeConfig', () => {
  test('overrides win over the fetched config', () => {
    const entry = valid();
    entry.overrides = { supabaseUrl: 'https://auth.example.com' };
    expect(resolveStoredRuntimeConfig(entry)).toMatchObject({
      supabaseUrl: 'https://auth.example.com',
      supabaseAnonKey: 'anon-key',
    });
  });
});

describe('storage', () => {
  test('round-trips a valid entry', () => {
    writeStoredServerConfig(valid());
    expect(readStoredServerConfig()).toEqual(valid());
  });

  test('refuses to write an invalid entry', () => {
    expect(() => writeStoredServerConfig({ ...valid(), serverUrl: 'nope' })).toThrow();
    expect(localStorage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBeNull();
  });

  test('reads malformed JSON as no entry', () => {
    localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, '{oops');
    expect(readStoredServerConfig()).toBeNull();
  });
});

describe('bootstrap script', () => {
  const runBootstrap = () => {
    // Global scope, as the browser runs the inline <script>.
    new Function(getServerConfigBootstrapScript())();
  };

  test('installs a valid stored config with overrides applied', () => {
    const entry = valid();
    entry.overrides = { supabaseUrl: 'https://auth.example.com' };
    localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(entry));
    runBootstrap();
    expect(win['__READEST_RUNTIME_CONFIG']).toEqual({
      ...entry.config,
      supabaseUrl: 'https://auth.example.com',
    });
    expect(win['__READEST_SERVER_CONFIG_INVALID']).toBeUndefined();
  });

  test('does nothing without a stored config', () => {
    runBootstrap();
    expect(win['__READEST_RUNTIME_CONFIG']).toBeUndefined();
    expect(win['__READEST_SERVER_CONFIG_INVALID']).toBeUndefined();
  });

  test('flags a malformed entry without installing it', () => {
    localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, '{oops');
    runBootstrap();
    expect(win['__READEST_RUNTIME_CONFIG']).toBeUndefined();
    expect(win['__READEST_SERVER_CONFIG_INVALID']).toBe(true);
  });

  test('flags an entry with a non-URL supabaseUrl', () => {
    const entry = valid();
    entry.config.supabaseUrl = 'not a url';
    localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(entry));
    runBootstrap();
    expect(win['__READEST_RUNTIME_CONFIG']).toBeUndefined();
    expect(win['__READEST_SERVER_CONFIG_INVALID']).toBe(true);
  });

  test('contains no optional chaining or nullish coalescing', () => {
    const script = getServerConfigBootstrapScript();
    expect(script).not.toMatch(/\?\.[a-zA-Z_$]/);
    expect(script).not.toContain('??');
  });
});

describe('normalizeServerUrl', () => {
  test.each([
    ['https://books.example.com/', 'https://books.example.com'],
    ['  https://books.example.com/some/path ', 'https://books.example.com'],
    ['https://books.example.com:8443', 'https://books.example.com:8443'],
  ])('reduces %s to its origin', (input, expected) => {
    expect(normalizeServerUrl(input)).toEqual({ url: expected });
  });

  test('requires acknowledgement for plain http', () => {
    expect(normalizeServerUrl('http://192.168.1.10:3000')).toEqual({ error: 'insecure' });
    expect(normalizeServerUrl('http://192.168.1.10:3000', { allowHttp: true })).toEqual({
      url: 'http://192.168.1.10:3000',
    });
  });

  test.each(['ftp://example.com', 'books example', '', 'example.com'])('rejects %s', (input) => {
    expect(normalizeServerUrl(input)).toEqual({ error: 'invalid' });
  });
});
