import { describe, expect, test } from 'vitest';
import nextConfig from '../../next.config.mjs';

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
