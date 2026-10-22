// A streamed comic page is fetched with its catalog's certificate choice, which
// is on unless the user turned it off - including for a feed opened without a
// saved catalog.
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  catalogs: [] as Array<{ id: string; url: string; allowSelfSignedCert?: boolean }>,
}));

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/services/constants', () => ({ READEST_OPDS_USER_AGENT: 'Readest' }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { opdsCatalogs: h.catalogs } }) },
}));
vi.mock('@/app/opds/utils/opdsReq', () => ({
  needsProxy: () => false,
  getProxiedURL: (url: string) => url,
  probeAuth: async () => null,
  withOriginSuppressed: (headers: Record<string, string>) => headers,
}));

import { createPseStreamPageLoader } from '@/services/opds/pseStream';

const data = {
  url: 'https://library.example.com/opds/book/7/page/{pageNumber}',
  catalogId: 'catalog-1',
  count: 1,
  title: 'Streamed',
  author: 'Author',
};

const fetchedInit = async (url = data.url) => {
  const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
  vi.stubGlobal('fetch', fetch);
  await createPseStreamPageLoader({ ...data, url })(0);
  return (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
};

describe('createPseStreamPageLoader certificate choice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    h.catalogs = [];
  });

  it('accepts self-signed certificates for a feed opened without a saved catalog', async () => {
    expect(await fetchedInit()).toHaveProperty('danger');
  });

  // The choice covers the catalog's own origin only: a page URL the feed
  // points at on another host is verified.
  it("applies a catalog's choice to its own origin only", async () => {
    h.catalogs = [{ id: 'catalog-1', url: 'https://library.example.com/opds' }];
    expect(await fetchedInit()).toHaveProperty('danger');
    expect(await fetchedInit('https://cdn.example.net/page/{pageNumber}')).not.toHaveProperty(
      'danger',
    );
  });

  it('verifies certificates for a catalog that turned the option off', async () => {
    h.catalogs = [{ id: 'catalog-1', url: data.url, allowSelfSignedCert: false }];
    expect(await fetchedInit()).not.toHaveProperty('danger');
  });
});
