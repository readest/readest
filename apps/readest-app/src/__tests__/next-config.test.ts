import { afterEach, describe, expect, test, vi } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { SEND_INBOX_FILE_MAX_BYTES } from '@/services/constants';

/** Next's own `getCloneableBody` fallback (`DEFAULT_BODY_CLONE_SIZE_LIMIT`). */
const NEXT_DEFAULT_BODY_CLONE_LIMIT = 10 * 1024 * 1024;

/** Re-evaluate next.config.mjs as the Docker image builds it. */
const loadSelfHostedConfig = async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
  vi.stubEnv('BUILD_STANDALONE', 'true');
  vi.resetModules();
  return (await import('../../next.config.mjs')).default;
};

describe('Next.js static asset headers', () => {
  test('keeps bundled workers cross-origin isolated', async () => {
    const rules = ((await nextConfig.headers?.()) ?? []) as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const staticRule = rules.find((rule) => rule.source === '/_next/static/:path*');

    expect(staticRule?.headers).toContainEqual({
      key: 'Cross-Origin-Embedder-Policy',
      value: 'require-corp',
    });
  });
});

describe('Proxy request body clone limit', () => {
  // `middleware.ts` matches every /api/* route, and Next buffers a clone of the
  // request body so both the middleware and the route handler can read it. Past
  // `experimental.proxyClientMaxBodySize` the clone is truncated and the route
  // handler sees a short body with a clean `end` — a silently corrupt upload,
  // not an error (#6091).
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('every build raises it past the truncating default', () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeGreaterThan(
      NEXT_DEFAULT_BODY_CLONE_LIMIT,
    );
  });

  // The clone is buffered in memory before any handler can reject it, so the
  // ceiling is also an unauthenticated memory budget on every /api/* route.
  // Only the self-hosted image — which may proxy whole book files through the
  // Node server — gets real headroom, so it is also the only build guaranteed
  // to carry the largest body our own routes accept. Cloudflare and Vercel
  // never reach this code path, leaving `next start` as the one place where the
  // narrower budget can still clip an inbox upload.
  test('only the self-hosted Docker build covers the largest API route body', async () => {
    const selfHosted = await loadSelfHostedConfig();

    expect(selfHosted.output).toBe('standalone');
    expect(selfHosted.experimental?.proxyClientMaxBodySize).toBeGreaterThanOrEqual(
      SEND_INBOX_FILE_MAX_BYTES,
    );
    expect(selfHosted.experimental?.proxyClientMaxBodySize).toBeGreaterThan(
      nextConfig.experimental?.proxyClientMaxBodySize as number,
    );
  });
});
