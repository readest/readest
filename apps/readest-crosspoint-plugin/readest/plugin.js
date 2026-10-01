// Readest sign-in for CrossPoint. Checks the email and password against
// Readest's auth server through the device relay, then stores them for the
// on-device Readest screen (device.json), which mints a fresh access token
// from them whenever the stored one expires.
CrossPoint.registerPlugin(async (container, api) => {
  const API = 'https://web.readest.com/api';
  const AUTH = 'https://readest.supabase.co/auth/v1';
  // Readest's public (anon) Supabase key, kept base64-encoded like the koplugin's.
  const APIKEY = atob(
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw==',
  );
  // The password and token live in dotfiles, which the device web server
  // refuses to serve; the account file only records who is signed in.
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
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" name="signin">Sign in</button> ' +
    '<button type="button" class="btn-small" name="signout">Sign out</button>' +
    '</div>' +
    '<p style="color:#666">Your Readest library appears on the reader under Plugins → Readest. ' +
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
      await writeJson(CONFIG_PATH, {
        email: escaped(email),
        password: escaped(password),
        api: API,
        auth: AUTH,
        apikey: APIKEY,
      });
      await writeJson(TOKEN_PATH, { access_token: data.access_token });
      await writeJson(ACCOUNT_PATH, { email });
      $('[name="password"]').value = '';
      status(`Signed in as ${email}.`);
    } catch (e) {
      status(`Error: ${e.message}`);
    }
  };

  $('[name="signout"]').onclick = async () => {
    try {
      for (const path of [CONFIG_PATH, TOKEN_PATH, ACCOUNT_PATH]) await writeJson(path, {});
      status('Signed out.');
    } catch (e) {
      status(`Error: ${e.message}`);
    }
  };

  try {
    const res = await fetch(`/download?path=${encodeURIComponent(ACCOUNT_PATH)}`);
    const { email } = res.ok ? await res.json() : {};
    status(email ? `Signed in as ${email}.` : 'Not signed in.');
  } catch {
    status('Not signed in.');
  }
});
