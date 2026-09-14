import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { browserFetch } from '@/services/webBrowser/browserFetch';

beforeEach(() => {
  invoke.mockReset();
});

describe('browser session requests', () => {
  it('returns binary content and the final URL without exposing cookies', async () => {
    invoke.mockResolvedValue({
      url: 'https://example.org/chapter/1',
      status: 200,
      contentType: 'text/html; charset=gbk',
      body: btoa('signed in'),
    });
    const response = await browserFetch('https://example.org/redirect', {
      headers: { Referer: 'https://example.org/toc' },
    });
    expect(invoke).toHaveBeenCalledWith('fetch_web_browser_resource', {
      url: 'https://example.org/redirect',
      headers: { referer: 'https://example.org/toc' },
    });
    expect(response.url).toBe('https://example.org/chapter/1');
    expect(response.headers.get('content-type')).toBe('text/html; charset=gbk');
    expect(await response.text()).toBe('signed in');
  });

  it('preserves an authentication failure status for the importer', async () => {
    invoke.mockResolvedValue({
      url: 'https://example.org/private',
      status: 401,
      body: '',
      contentType: 'text/html',
    });
    expect((await browserFetch('https://example.org/private')).status).toBe(401);
  });

  it('stops awaiting a request when cancelled', async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = browserFetch('https://example.org/private', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start an already cancelled request', async () => {
    await expect(
      browserFetch('https://example.org/private', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
