import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The CrossPoint SD plugin in apps/readest-crosspoint-plugin: plugin.js runs in
// the reader's web settings page, device.json is interpreted by the firmware.
const PLUGIN_DIR = resolve(__dirname, '../../../../readest-crosspoint-plugin/readest');
const read = (file: string) => readFileSync(resolve(PLUGIN_DIR, file), 'utf8');
const deviceJson = JSON.parse(read('device.json'));

interface PluginApi {
  name: string;
  relay: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}

// The firmware fills device.json templates by plain substitution, no escaping.
const fill = (template: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);

const decodeBase64Json = (b64: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

const writtenFiles = (api: PluginApi) =>
  Object.fromEntries(
    api.writeFile.mock.calls.map(([path, b64]) => [
      path as string,
      decodeBase64Json(b64 as string),
    ]),
  );

let container: HTMLElement;
let api: PluginApi;

const mount = async (account: unknown = null) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      account ? new Response(JSON.stringify(account)) : new Response('', { status: 404 }),
    ),
  );
  let render: (c: HTMLElement, a: PluginApi) => Promise<void> = async () => {};
  vi.stubGlobal('CrossPoint', {
    registerPlugin: (fn: typeof render) => {
      render = fn;
    },
  });
  new Function(read('plugin.js'))();
  await render(container, api);
};

const field = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement;
const statusText = () => container.querySelector('[data-status]')?.textContent ?? '';

const signIn = (email: string, password: string) => {
  field('email').value = email;
  field('password').value = password;
  field('signin').click();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  api = { name: 'readest', relay: vi.fn(), writeFile: vi.fn().mockResolvedValue({}) };
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe('Readest CrossPoint plugin', () => {
  it('signs in through the device relay and stores credentials the firmware can template', async () => {
    api.relay.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ access_token: 'jwt' }),
      headers: [],
    });
    await mount();
    const password = 'p"a\\ss é';
    signIn(' reader@example.com ', password);
    await vi.waitFor(() => expect(statusText()).toContain('Signed in as reader@example.com'));

    const [method, url, headers, body] = api.relay.mock.calls[0]!;
    expect(method).toBe('POST');
    expect(url).toBe('https://readest.supabase.co/auth/v1/token?grant_type=password');
    expect(JSON.parse(body)).toEqual({ email: 'reader@example.com', password });

    const files = writtenFiles(api);
    expect(files[deviceJson.token.file]).toEqual({ access_token: 'jwt' });
    const config = files[deviceJson.config.file];
    expect(config.api).toBe('https://web.readest.com/api');
    // The device mints later tokens from the same stored values: rendering its
    // auth request must reproduce exactly what the browser just sent.
    const vars = Object.fromEntries(Object.entries(config).map(([k, v]) => [`cfg.${k}`, `${v}`]));
    const auth = deviceJson.auth.request;
    expect(fill(auth.url, vars)).toBe(url);
    expect(fill(auth.headers.apikey, vars)).toBe(headers.apikey);
    expect(JSON.parse(fill(auth.body, vars))).toEqual({ email: 'reader@example.com', password });
  });

  it('stores nothing when the sign-in is rejected', async () => {
    api.relay.mockResolvedValue({
      status: 400,
      // Readest's Supabase auth error shape.
      body: JSON.stringify({
        code: 400,
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      }),
      headers: [],
    });
    await mount();
    signIn('reader@example.com', 'wrong');
    await vi.waitFor(() => expect(statusText()).toContain('Invalid login credentials'));
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('shows the signed-in account and signs out by clearing every stored file', async () => {
    await mount({ email: 'reader@example.com' });
    expect(statusText()).toContain('Signed in as reader@example.com');

    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toContain('Signed out'));
    const files = writtenFiles(api);
    expect(files[deviceJson.config.file]).toEqual({});
    expect(files[deviceJson.token.file]).toEqual({});
    expect(Object.values(files)).toEqual([{}, {}, {}]);
  });

  it('pages the catalog in steps of the page size the firmware displays', () => {
    // The firmware shows `page_size` rows and drops the lookahead row, so the
    // server must step pages by `page_size`, not by {limit} (page_size + 1).
    const vars = { 'cfg.api': 'https://web.readest.com/api', page: '2', query: 'moby' };
    for (const template of [deviceJson.browse.url, deviceJson.browse.search.url]) {
      const url = new URL(fill(template, vars));
      expect(url.pathname).toBe('/api/library/books');
      expect(url.searchParams.get('page')).toBe('2');
      expect(Number(url.searchParams.get('per_page'))).toBe(deviceJson.browse.page_size);
    }
  });

  it('keeps the password and token where the device web server will not serve them', () => {
    // GET /download refuses any path whose file name starts with a dot.
    for (const path of [deviceJson.config.file, deviceJson.token.file]) {
      expect(path.split('/').pop()).toMatch(/^\./);
    }
  });

  it('reports each reading session to Readest statistics as a page event', () => {
    const handler = deviceJson.events['reader.session'];
    expect(handler.connect).toBe(true);
    expect(fill(handler.request.url, { 'cfg.api': 'https://web.readest.com/api' })).toBe(
      'https://web.readest.com/api/sync',
    );
    const body = fill(handler.request.body, {
      'event.document': '0123456789abcdef0123456789abcdef',
      'event.start_time': '1790000000',
      'event.duration_seconds': '600',
      'event.start_progress_bp': '5100',
      'event.end_progress_bp': '5230',
      'event.progress_scale': '10000',
    });
    expect(JSON.parse(body)).toEqual({
      statPages: [
        {
          book_hash: '0123456789abcdef0123456789abcdef',
          page: 5230,
          start_time: 1790000000,
          duration: 600,
          total_pages: 10000,
        },
      ],
    });
  });
});
