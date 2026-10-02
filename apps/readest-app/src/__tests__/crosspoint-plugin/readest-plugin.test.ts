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

const API = 'https://web.readest.com/api/crosspoint';
const TOKEN_FILE = deviceJson.token.file;
const ACCOUNT_FILE = '/.crosspoint/readest-account.json';
const EMAIL = 'reader@example.com';
const CODE = {
  device_code: 'dc',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://web.readest.com/link',
  verification_uri_complete: 'https://web.readest.com/link?code=BCDF-GHJK',
  expires_in: 600,
  interval: 0.001,
};
const KEY = { access_token: 'device-key', token_type: 'bearer', id: 'new-key-id', username: EMAIL };

let container: HTMLElement;
let api: PluginApi;
// The reader's web API: GET /api/settings reports these, POST /api/settings is recorded.
let deviceSettings: Record<string, unknown>;
let settingsPosts: Record<string, unknown>[];
let settingsPostStatus: number;
// Relayed requests, file writes and settings posts, in order.
let log: string[];

const mount = async (account: unknown = null) => {
  const sink = log;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/download')) {
        return account ? new Response(JSON.stringify(account)) : new Response('', { status: 404 });
      }
      if (url === '/api/settings' && init?.method === 'POST') {
        sink.push('settings');
        settingsPosts.push(JSON.parse(String(init.body)));
        return new Response('Applied', { status: settingsPostStatus });
      }
      if (url === '/api/settings') {
        const items = Object.entries(deviceSettings).map(([key, value]) => ({ key, value }));
        return new Response(JSON.stringify(items));
      }
      return new Response('', { status: 404 });
    }),
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
const relayCalls = (method: string, path = '') =>
  api.relay.mock.calls.filter(([m, url]) => m === method && String(url).startsWith(API + path));
// The last content written to each file.
const files = () =>
  Object.fromEntries(
    api.writeFile.mock.calls.map(([path, b64]) => [
      path as string,
      decodeBase64Json(b64 as string),
    ]),
  );

const json = (status: number, body: unknown) => ({
  status,
  body: JSON.stringify(body),
  headers: [],
});

const PENDING = json(400, { error: 'authorization_pending' });

// Answers relayed requests the way Readest does. By default the code is
// approved on the second poll and revocations succeed.
const readest = ({
  token = (poll: number) => (poll ? json(200, KEY) : PENDING),
  revokeStatus = 200,
}: {
  token?: (poll: number) => unknown;
  revokeStatus?: number;
} = {}) => {
  // Logs into this test's array even if a request outlives the test.
  const sink = log;
  let polls = 0;
  api.relay.mockImplementation(async (method: string, url: string) => {
    sink.push(`${method} ${url.replace(API, '')}`);
    if (url === `${API}/device/code`) return json(200, CODE);
    if (url === `${API}/device/token`) return token(polls++);
    if (method === 'DELETE') return json(revokeStatus, { revoked: revokeStatus === 200 });
    return json(404, {});
  });
};

// Clicking Sign in disables it until the whole sign-in has finished.
const signIn = async (done = `Signed in as ${EMAIL}.`) => {
  field('signin').click();
  expect(field('signin').disabled).toBe(true);
  await vi.waitFor(() => expect(field('signin').disabled).toBe(false));
  expect(statusText()).toBe(done);
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  const sink: string[] = (log = []);
  api = {
    name: 'readest',
    relay: vi.fn(),
    writeFile: vi.fn(async (path: string) => {
      sink.push(`write ${path}`);
      return {};
    }),
  };
  deviceSettings = {};
  settingsPosts = [];
  settingsPostStatus = 200;
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe('Readest CrossPoint plugin', () => {
  it('signs in with a code approved on the Readest web app and stores only the reader’s key', async () => {
    let approved = false;
    readest({ token: () => (approved ? json(200, KEY) : PENDING) });
    await mount();
    expect(statusText()).toBe('Not signed in.');
    field('signin').click();

    await vi.waitFor(() => expect(statusText()).toBe('Waiting for approval…'));
    const link = container.querySelector('[data-link]') as HTMLAnchorElement;
    expect(link.href).toBe(CODE.verification_uri_complete);
    expect(link.textContent).toBe(CODE.verification_uri);
    expect(container.querySelector('[data-user-code]')?.textContent).toBe('BCDF-GHJK');

    approved = true;
    await vi.waitFor(() => expect(statusText()).toBe(`Signed in as ${EMAIL}.`));
    expect((container.querySelector('[data-code]') as HTMLElement).hidden).toBe(true);
    expect(api.relay).toHaveBeenCalledWith(
      'POST',
      `${API}/device/token`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({ device_code: 'dc' }),
    );
    // Nothing account-level reaches the card: only the key and who it belongs to.
    expect(files()).toEqual({
      [TOKEN_FILE]: { access_token: 'device-key' },
      [ACCOUNT_FILE]: { username: EMAIL, keyId: 'new-key-id', revoke: [] },
    });
  });

  it('points the reader’s KOReader Sync at Readest with the key', async () => {
    readest();
    await mount();
    // KOReader Sync isn't set up on the reader, so progress sync is on by default.
    expect(field('kosync').checked).toBe(true);
    await signIn();
    expect(settingsPosts).toEqual([
      {
        koServerUrl: API,
        koUsername: EMAIL, // a label: the key alone authenticates
        koPassword: 'device-key',
        koMatchMethod: 1, // Binary: Readest identifies books by partial MD5
        koSyncBehavior: 1, // Smart
      },
    ]);
  });

  it('asks before replacing a KOReader Sync server set up on the reader', async () => {
    readest();
    deviceSettings = { koServerUrl: 'https://sync.koreader.rocks', koUsername: 'me' };
    await mount();
    expect(field('kosync').checked).toBe(false);
    expect(container.textContent).toContain('replaces https://sync.koreader.rocks');

    await signIn();
    expect(settingsPosts).toEqual([]);
    expect(files()[TOKEN_FILE]).toEqual({ access_token: 'device-key' });
  });

  it('replaces that server when the user opts in', async () => {
    readest();
    deviceSettings = { koServerUrl: 'https://sync.koreader.rocks', koUsername: 'me' };
    await mount();
    field('kosync').checked = true;
    await signIn();
    expect(settingsPosts).toEqual([expect.objectContaining({ koServerUrl: API })]);
  });

  it('turns Readest progress sync off when signing in again with it unchecked', async () => {
    readest();
    deviceSettings = { koServerUrl: API, koUsername: EMAIL };
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    // Readest is already the reader's sync server, so nothing is "replaced".
    expect(field('kosync').checked).toBe(true);
    expect(container.textContent).not.toContain('replaces');

    field('kosync').checked = false;
    await signIn();
    expect(settingsPosts).toEqual([{ koServerUrl: '', koUsername: '', koPassword: '' }]);
  });

  it('revokes the key it replaces only once the new one is in place', async () => {
    readest();
    await mount({ username: 'old@example.com', keyId: 'old-key-id' });
    await signIn();
    expect(relayCalls('DELETE')).toEqual([['DELETE', `${API}/keys/old-key-id`, {}, '']]);
    expect(log.indexOf('DELETE /keys/old-key-id')).toBeGreaterThan(log.indexOf('settings'));
  });

  it('keeps keys it could not revoke and retries them at sign-out', async () => {
    readest({ revokeStatus: 500 });
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    await signIn();
    expect(files()[ACCOUNT_FILE]).toEqual({
      username: EMAIL,
      keyId: 'new-key-id',
      revoke: ['old-key-id'],
    });

    readest();
    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(relayCalls('DELETE').slice(1)).toEqual([
      ['DELETE', `${API}/keys/old-key-id`, {}, ''],
      ['DELETE', `${API}/keys/new-key-id`, {}, ''],
    ]);
    expect(files()[ACCOUNT_FILE]).toEqual({});
  });

  it('records a new key before handing it out, so a failed setup leaves it revocable', async () => {
    readest();
    settingsPostStatus = 500;
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    await signIn('Sign-in failed: could not update KOReader Sync settings (HTTP 500)');
    expect(log.indexOf(`write ${ACCOUNT_FILE}`)).toBeLessThan(log.indexOf(`write ${TOKEN_FILE}`));
    expect(files()[ACCOUNT_FILE]).toEqual({ revoke: ['old-key-id', 'new-key-id'] });
    // Neither key is revoked yet: the reader may still be using either.
    expect(relayCalls('DELETE')).toEqual([]);
  });

  it('stores nothing when the code expires before it is approved', async () => {
    readest({ token: () => json(400, { error: 'expired_token' }) });
    await mount();
    await signIn('Sign-in failed: the code expired');
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(settingsPosts).toEqual([]);
    expect(field('signin').disabled).toBe(false);
  });

  it('reports an unreachable Readest', async () => {
    api.relay.mockResolvedValue({ status: 502, body: 'relay failed', headers: [] });
    await mount();
    await signIn('Sign-in failed: Readest is unreachable (HTTP 502)');
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('ignores a second click while a sign-in is running', async () => {
    readest({ token: () => PENDING });
    await mount();
    field('signin').click();
    field('signin').click();
    await vi.waitFor(() => expect(statusText()).toBe('Waiting for approval…'));
    expect(field('signin').disabled).toBe(true);
    expect(relayCalls('POST', '/device/code')).toHaveLength(1);
    field('signout').click(); // stop polling
  });

  it('stops waiting for approval when the user signs out', async () => {
    readest({ token: () => PENDING });
    await mount();
    field('signin').click();
    await vi.waitFor(() => expect(relayCalls('POST', '/device/token').length).toBeGreaterThan(0));

    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    await vi.waitFor(() => expect(field('signin').disabled).toBe(false));
    const polls = relayCalls('POST', '/device/token').length;
    await new Promise((r) => setTimeout(r, 20));
    expect(relayCalls('POST', '/device/token')).toHaveLength(polls);
    expect(files()[TOKEN_FILE]).toEqual({});
  });

  it('revokes a key approved after the user signed out', async () => {
    let approve: (v: unknown) => void = () => {};
    // The approval lands while the poll is in flight.
    readest({ token: () => new Promise((r) => (approve = r)) });
    await mount();
    field('signin').click();
    await vi.waitFor(() => expect(relayCalls('POST', '/device/token')).toHaveLength(1));
    field('signout').click();
    approve(json(200, KEY));

    await vi.waitFor(() =>
      expect(relayCalls('DELETE')).toEqual([['DELETE', `${API}/keys/new-key-id`, {}, '']]),
    );
    expect(statusText()).toBe('Signed out.');
    expect(files()[TOKEN_FILE]).toEqual({});
  });

  it('signs out by revoking the key first, then clearing the card and Readest’s sync settings', async () => {
    readest();
    deviceSettings = { koServerUrl: API };
    await mount({ username: EMAIL, keyId: 'key-id' });
    expect(statusText()).toBe(`Signed in as ${EMAIL}.`);

    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(log).toEqual([
      'DELETE /keys/key-id',
      `write ${ACCOUNT_FILE}`,
      `write ${TOKEN_FILE}`,
      'settings',
    ]);
    expect(settingsPosts).toEqual([{ koServerUrl: '', koUsername: '', koPassword: '' }]);
    expect(files()).toEqual({ [ACCOUNT_FILE]: {}, [TOKEN_FILE]: {} });
  });

  it('leaves a KOReader Sync server the user set up later alone at sign-out', async () => {
    readest();
    deviceSettings = { koServerUrl: 'https://sync.koreader.rocks' };
    await mount({ username: EMAIL, keyId: 'key-id' });
    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(settingsPosts).toEqual([]);
  });

  // The buttons follow the card's state: Sign in, with the progress sync choice
  // it applies, while signed out; Sign out while signed in.
  describe('buttons', () => {
    const shown = (el: Element | null) => (el as HTMLElement | null)?.style.display !== 'none';
    const syncRow = () => container.querySelector('[data-kosync-row]');

    it('offers Sign in and the progress sync choice while signed out', async () => {
      readest();
      await mount();
      expect(shown(field('signin'))).toBe(true);
      expect(shown(syncRow())).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });

    it('offers only Sign out while signed in', async () => {
      readest();
      await mount({ username: EMAIL, keyId: 'key-id' });
      expect(shown(field('signin'))).toBe(false);
      expect(shown(syncRow())).toBe(false);
      expect(shown(field('signout'))).toBe(true);
    });

    it('switches as the user signs in and out', async () => {
      readest();
      await mount();
      await signIn();
      expect(shown(field('signin'))).toBe(false);
      expect(shown(field('signout'))).toBe(true);

      field('signout').click();
      await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
      expect(shown(field('signin'))).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });

    // The account file is cleared first, so the card is signed out (a reload
    // shows Sign in) even when clearing KOReader Sync afterwards fails.
    it('shows Sign in once the account is cleared, even if later cleanup fails', async () => {
      readest();
      deviceSettings = { koServerUrl: API };
      settingsPostStatus = 500;
      await mount({ username: EMAIL, keyId: 'key-id' });
      field('signout').click();
      await vi.waitFor(() => expect(statusText()).toMatch(/^Error: /));
      expect(files()[ACCOUNT_FILE]).toEqual({});
      expect(shown(field('signin'))).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });
  });

  it('leaves sign-in to the web page, the only one that can set up progress sync', () => {
    // The firmware refuses plugin writes to KOReader Sync settings, so a
    // sign-in on the reader's own screen left progress sync silently off.
    // Without an auth block, Plugins → Readest tells the user to sign in on
    // the web Settings page instead.
    expect(deviceJson).not.toHaveProperty('auth');
    // The reader reads the key where the web page writes it.
    expect(deviceJson.token).toEqual({ file: TOKEN_FILE, path: 'access_token' });
  });

  it('pages the catalog in steps of the page size the firmware displays', () => {
    // The firmware shows `page_size` rows and drops the lookahead row, so the
    // server must step pages by `page_size`, not by {limit} (page_size + 1).
    const vars = { page: '2', query: 'moby' };
    for (const template of [deviceJson.browse.url, deviceJson.browse.search.url]) {
      const url = new URL(fill(template, vars));
      expect(`${url.origin}${url.pathname}`).toBe(`${API}/books`);
      expect(url.searchParams.get('page')).toBe('2');
      expect(Number(url.searchParams.get('per_page'))).toBe(deviceJson.browse.page_size);
    }
    expect(deviceJson.browse.headers).toEqual({ Authorization: 'Bearer {token}' });
    expect(deviceJson.download.url_path).toBe('downloadUrl');
  });

  it('keeps the key where the device web server will not serve it', () => {
    // GET /download refuses any path whose file name starts with a dot.
    expect(TOKEN_FILE.split('/').pop()).toMatch(/^\./);
  });

  it('reports each reading session to Readest', () => {
    const handler = deviceJson.events['reader.session'];
    expect(handler.connect).toBe(true);
    expect(handler.request.url).toBe(`${API}/sessions`);
    expect(fill(handler.request.headers.Authorization, { token: 'device-key' })).toBe(
      'Bearer device-key',
    );
    const body = fill(handler.request.body, {
      'event.document': '0123456789abcdef0123456789abcdef',
      'event.start_time': '1790000000',
      'event.duration_seconds': '600',
      'event.start_progress_bp': '5100',
      'event.end_progress_bp': '5230',
    });
    expect(JSON.parse(body)).toEqual({
      document: '0123456789abcdef0123456789abcdef',
      start_time: 1790000000,
      duration: 600,
      start_bp: 5100,
      end_bp: 5230,
    });
  });
});
