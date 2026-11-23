// @vitest-environment node
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * KOReader's Readest > Sign in with a code calls the device sign-in routes
 * through readest-sync-api.json. They live at /api/auth/device; the
 * /api/crosspoint/device paths stay only for plugins already installed.
 */

const spec = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../readest.koplugin/readest-sync-api.json'), 'utf8'),
) as { base_url: string; methods: Record<string, { path: string; method: string }> };

/** The app-router route file a plugin URL lands on, or null when it is not under /api. */
const routeFile = (url: string) => {
  const path = new URL(url).pathname.match(/^\/api\/(.+)$/)?.[1];
  return path ? resolve(__dirname, '../../app/api', path, 'route.ts') : null;
};

describe('KOReader plugin sign-in with a code', () => {
  it.each([
    ['requestDeviceCode', 'https://web.readest.com/api/auth/device/code'],
    ['pollDeviceToken', 'https://web.readest.com/api/auth/device/token'],
  ])('%s calls %s, a route the server has', (name, url) => {
    const method = spec.methods[name]!;
    expect(`${spec.base_url}${method.path}`).toBe(url);
    expect(method.method).toBe('POST');
    expect(existsSync(routeFile(url)!), routeFile(url)!).toBe(true);
  });
});
