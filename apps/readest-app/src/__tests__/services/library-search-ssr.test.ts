// @vitest-environment node
import { describe, expect, it } from 'vitest';

// The reader and library pages import this service statically, so Next.js
// evaluates its module graph on the server while collecting page data —
// where browser globals like NodeFilter do not exist.
describe('librarySearchService SSR safety', () => {
  it('imports without browser globals', async () => {
    expect(typeof NodeFilter).toBe('undefined');
    await expect(import('@/services/librarySearchService')).resolves.toBeDefined();
  });
});
