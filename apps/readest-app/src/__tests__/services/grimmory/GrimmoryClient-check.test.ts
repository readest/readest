import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimmoryClient } from '@/services/grimmory/GrimmoryClient';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const connection = (serverUrl: string) =>
  ({ serverUrl, username: 'reader', password: 'test' }) as ConstructorParameters<
    typeof GrimmoryClient
  >[0];

const stubServer = (handler: (url: string) => Response) => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return handler(String(url));
  });
  vi.stubGlobal('fetch', fetchMock);
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return calls;
};

describe('GrimmoryClient.checkConnection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses the session instead of signing in again', async () => {
    const calls = stubServer((url) =>
      url.includes('/login')
        ? json(200, { accessToken: 'token', refreshToken: 'r' })
        : json(200, { current: '1.0.0' }),
    );
    const client = new GrimmoryClient(connection('http://192.168.1.60'));

    expect(await client.checkConnection()).toEqual({ success: true });
    expect(await client.checkConnection()).toEqual({ success: true });

    expect(calls.filter((url) => url.includes('/login'))).toHaveLength(1);
  });

  it('reports a refused login as invalid credentials', async () => {
    stubServer(() => json(401, { message: 'Unauthorized' }));
    const client = new GrimmoryClient(connection('http://192.168.1.61'));

    expect(await client.checkConnection()).toEqual({
      success: false,
      message: 'Invalid credentials.',
    });
  });

  it('reports a server that fails', async () => {
    stubServer(() => {
      throw new Error('Network down');
    });
    const client = new GrimmoryClient(connection('http://192.168.1.62'));

    expect(await client.checkConnection()).toEqual({ success: false, message: 'Network down' });
  });
});
