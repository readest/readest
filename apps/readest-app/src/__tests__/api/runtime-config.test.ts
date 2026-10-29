import { describe, test, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/runtime-config/route';

const env = process.env as Record<string, string | undefined>;
const originalEnv = { ...env };

beforeEach(() => {
  Object.keys(env).forEach((key) => delete env[key]);
  Object.assign(env, originalEnv);
  for (const key of [
    'ALLOW_APP_CONNECTIONS',
    'SUPABASE_PUBLIC_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'API_BASE_URL',
    'NEXT_PUBLIC_API_BASE_URL',
    'SITE_URL',
    'OBJECT_STORAGE_TYPE',
    'NEXT_PUBLIC_OBJECT_STORAGE_TYPE',
    'SELF_HOSTED',
    'NEXT_PUBLIC_SELF_HOSTED',
    'STORAGE_FIXED_QUOTA',
    'NEXT_PUBLIC_STORAGE_FIXED_QUOTA',
    'TRANSLATION_FIXED_QUOTA',
    'NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA',
    'FONT_BASE_URL',
    'NEXT_PUBLIC_FONT_BASE_URL',
  ]) {
    delete env[key];
  }
  env['ALLOW_APP_CONNECTIONS'] = 'true';
});

describe('GET /api/runtime-config', () => {
  test('returns the public config of a self-hosted deployment as JSON', async () => {
    env['SUPABASE_PUBLIC_URL'] = 'https://books.example.com';
    env['SUPABASE_ANON_KEY'] = 'anon-key';
    env['API_BASE_URL'] = 'https://books.example.com';
    env['SELF_HOSTED'] = 'true';
    env['STORAGE_FIXED_QUOTA'] = '1073741824';

    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(await res.json()).toEqual({
      supabaseUrl: 'https://books.example.com',
      supabaseAnonKey: 'anon-key',
      apiBaseUrl: 'https://books.example.com',
      selfHosted: true,
      storageFixedQuota: 1073741824,
    });
  });

  test('omits fields the deployment does not set', async () => {
    env['SUPABASE_PUBLIC_URL'] = 'https://books.example.com';
    const body = await GET().json();
    expect(body).toEqual({ supabaseUrl: 'https://books.example.com' });
  });

  test('never publishes server-only secrets', async () => {
    const secrets: Record<string, string> = {
      SUPABASE_ADMIN_KEY: 'sentinel-admin-key',
      JWT_SECRET: 'sentinel-jwt-secret',
      SERVICE_ROLE_KEY: 'sentinel-service-role',
      POSTGRES_PASSWORD: 'sentinel-postgres-password',
      MINIO_ROOT_PASSWORD: 'sentinel-minio-password',
      S3_ACCESS_KEY_ID: 'sentinel-s3-access',
      S3_SECRET_ACCESS_KEY: 'sentinel-s3-secret',
      STRIPE_SECRET_KEY: 'sentinel-stripe-secret',
    };
    Object.assign(env, secrets);
    env['SUPABASE_PUBLIC_URL'] = 'https://books.example.com';
    env['SUPABASE_ANON_KEY'] = 'anon-key';

    const text = await GET().text();
    for (const value of Object.values(secrets)) {
      expect(text).not.toContain(value);
    }
  });

  describe('when app connections are not allowed', () => {
    beforeEach(() => {
      env['SUPABASE_PUBLIC_URL'] = 'https://books.example.com';
      env['SUPABASE_ANON_KEY'] = 'anon-key';
      env['SELF_HOSTED'] = 'true';
    });

    test.each([
      ['unset', undefined],
      ['false', 'false'],
      ['empty', ''],
    ])('answers 403 without the config when the flag is %s', async (_label, value) => {
      if (value === undefined) delete env['ALLOW_APP_CONNECTIONS'];
      else env['ALLOW_APP_CONNECTIONS'] = value;

      const res = GET();
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
      const text = await res.text();
      expect(text).not.toContain('books.example.com');
      expect(text).not.toContain('anon-key');
    });
  });
});
