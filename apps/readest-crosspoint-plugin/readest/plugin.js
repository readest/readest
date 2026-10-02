// Readest sign-in for CrossPoint. Checks the email and password against
// Readest's auth server through the device relay, then stores them for the
// on-device Readest screen (device.json), which mints a fresh access token
// from them whenever the stored one expires. It also points the reader's
// built-in KOReader Sync at Readest with a per-device key, so reading progress
// syncs without setting up a sync server.
CrossPoint.registerPlugin(async (container, api) => {
  const API = 'https://web.readest.com/api';
  const AUTH = 'https://readest.supabase.co/auth/v1';
  const KOSYNC_SERVER = `${API}/crosspoint`;
  // Readest's public (anon) Supabase key, kept base64-encoded like the koplugin's.
  const APIKEY = atob(
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw==',
  );
  // The password and token live in dotfiles, which the device web server
  // refuses to serve; the account file only records who is signed in and the
  // id of this reader's sync key.
  const CONFIG_PATH = '/.crosspoint/.readest.json';
  const TOKEN_PATH = '/.crosspoint/.readest-token.json';
  const ACCOUNT_PATH = '/.crosspoint/readest-account.json';

  container.innerHTML =
    '<h2>Readest</h2>' +
    '<p data-status>Checking sign-in…</p>' +
    '<div class="setting-row"><span class="setting-name">Email</span>' +
    '<span class="setting-control"><input type="email" name="email" autocomplete="username"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Password</span>' +
    '<span class="setting-control"><input type="password" name="password" autocomplete="current-password"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Sync reading progress<span data-kosync-note></span></span>' +
    '<span class="setting-control"><input type="checkbox" name="kosync" checked></span></div>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" name="signin">Sign in</button> ' +
    '<button type="button" class="btn-small" name="signout">Sign out</button>' +
    '</div>' +
    '<p style="color:#666">Your Readest library appears on the reader under Plugins → Readest. ' +
    'With Sync reading progress on, KOReader Sync on the reader syncs your position with Readest. ' +
    'The password is stored on the SD card so the reader can renew its sign-in.</p>';

  const $ = (selector) => container.querySelector(selector);
  const status = (text) => {
    $('[data-status]').textContent = text;
  };
  // btoa() alone throws on characters outside Latin-1.
  const writeJson = (path, value) =>
    api.writeFile(
      path,
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))),
    );
  // device.json substitutes {cfg.*} into a JSON body verbatim, so store values JSON-escaped.
  const escaped = (text) => JSON.stringify(text).slice(1, -1);
  const postSettings = async (settings) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`could not update KOReader Sync settings (HTTP ${res.status})`);
  };
  const readSettings = async () => {
    const res = await fetch('/api/settings');
    return res.ok ? await res.json() : [];
  };
  const settingValue = (settings, key) => settings.find((s) => s.key === key)?.value;
  // Best-effort: a key that outlives sign-out only reaches reading progress.
  const revokeKey = (keyId) =>
    keyId && api.relay('DELETE', `${KOSYNC_SERVER}/keys/${keyId}`, {}, '').catch(() => {});
  // Turn Readest progress sync off: revoke this reader's key and clear KOReader
  // Sync if it still points at Readest, leaving a server the user set up alone.
  const stopProgressSync = async (settings) => {
    await revokeKey(account.keyId);
    if (settingValue(settings, 'koServerUrl') === KOSYNC_SERVER) {
      await postSettings({ koServerUrl: '', koUsername: '', koPassword: '' });
    }
  };

  let account = {};

  $('[name="signin"]').onclick = async () => {
    const email = $('[name="email"]').value.trim();
    const password = $('[name="password"]').value;
    if (!email || !password) return status('Enter your email and password.');
    status('Signing in…');
    try {
      const res = await api.relay(
        'POST',
        `${AUTH}/token?grant_type=password`,
        { apikey: APIKEY, 'Content-Type': 'application/json' },
        JSON.stringify({ email, password }),
      );
      let data = {};
      try {
        data = JSON.parse(res.body);
      } catch {}
      if (res.status !== 200 || !data.access_token) {
        return status(`Sign-in failed: ${data.msg || `HTTP ${res.status}`}`);
      }
      const settings = await readSettings();
      let key = null;
      if ($('[name="kosync"]').checked) {
        const keyRes = await api.relay(
          'POST',
          `${KOSYNC_SERVER}/keys`,
          { Authorization: `Bearer ${data.access_token}` },
          '',
        );
        try {
          key = JSON.parse(keyRes.body);
        } catch {}
        if (keyRes.status !== 200 || !key?.key) {
          return status(`Sign-in failed: could not set up progress sync (HTTP ${keyRes.status})`);
        }
      }
      await writeJson(CONFIG_PATH, {
        email: escaped(email),
        password: escaped(password),
        api: API,
        auth: AUTH,
        apikey: APIKEY,
      });
      await writeJson(TOKEN_PATH, { access_token: data.access_token });
      if (key) {
        await postSettings({
          koServerUrl: KOSYNC_SERVER,
          koUsername: key.username,
          koPassword: key.key,
          koMatchMethod: 1, // Binary: Readest identifies books by partial MD5
          koSyncBehavior: 1, // Smart
        });
      } else {
        await stopProgressSync(settings);
      }
      const previousKeyId = account.keyId;
      account = key ? { email, keyId: key.id } : { email };
      await writeJson(ACCOUNT_PATH, account);
      if (key) await revokeKey(previousKeyId);
      $('[name="password"]').value = '';
      status(`Signed in as ${email}.`);
    } catch (e) {
      status(`Error: ${e.message}`);
    }
  };

  $('[name="signout"]').onclick = async () => {
    try {
      await stopProgressSync(await readSettings());
      account = {};
      for (const path of [CONFIG_PATH, TOKEN_PATH, ACCOUNT_PATH]) await writeJson(path, {});
      status('Signed out.');
    } catch (e) {
      status(`Error: ${e.message}`);
    }
  };

  try {
    const res = await fetch(`/download?path=${encodeURIComponent(ACCOUNT_PATH)}`);
    account = res.ok ? await res.json() : {};
    status(account.email ? `Signed in as ${account.email}.` : 'Not signed in.');
  } catch {
    status('Not signed in.');
  }
  try {
    // Don't take over a KOReader Sync server the user set up without asking
    // (an empty URL with a username means CrossPoint's own sync server).
    const settings = await readSettings();
    const server = settingValue(settings, 'koServerUrl');
    if (settingValue(settings, 'koUsername') && server !== KOSYNC_SERVER) {
      $('[name="kosync"]').checked = false;
      $('[data-kosync-note]').textContent = ` (replaces ${server || 'the CrossPoint sync server'})`;
    }
  } catch {}
});
