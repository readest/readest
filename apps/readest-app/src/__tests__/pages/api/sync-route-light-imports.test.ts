import { describe, it, expect, vi } from 'vitest';

// Every cold Worker isolate initialises the module graph of the route it
// serves, and on Cloudflare that start-up CPU is most of the sync routes' bill.
// These routes only check a token and read/write rows, so they must not pull in
// language detection (franc-min, iso-639-*) or DOMPurify. They used to: through
// access.ts -> translators/utils.ts (for the localStorage daily-usage helper)
// and through transform.ts -> sanitize.ts (for a NUL-stripping helper).

const HEAVY = ['franc-min', 'iso-639-2', 'iso-639-3', 'dompurify'];

describe('hot sync API routes', () => {
  it.each([
    ['/api/sync', () => import('@/pages/api/sync')],
    ['/api/sync/replicas', () => import('@/pages/api/sync/replicas')],
    ['/api/sync/vocabulary', () => import('@/pages/api/sync/vocabulary')],
    ['/api/send/inbox/claim', () => import('@/pages/api/send/inbox/claim')],
  ])('%s does not load language detection or DOMPurify', async (_route, load) => {
    const loaded: string[] = [];
    vi.resetModules();
    for (const name of HEAVY) {
      vi.doMock(name, () => {
        loaded.push(name);
        return { default: {} };
      });
    }
    await load();
    expect(loaded).toEqual([]);
  });
});
