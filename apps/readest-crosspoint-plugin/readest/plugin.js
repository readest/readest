// Readest sign-in for CrossPoint. Signing in links this reader to a Readest
// account with a code its owner approves on the Readest web app; the reader
// then gets its own key, never a password. The on-device Readest screen
// (device.json) uses the key for the library and reading statistics, and with
// Sync reading progress on, the reader's built-in KOReader Sync uses it to
// sync progress with Readest, without setting up a sync server. This page is
// the only place to sign in: the firmware won't let a plugin set KOReader Sync
// from the reader's own screen, so a sign-in there left progress sync off.
CrossPoint.registerPlugin(async (container, api) => {
  const API = 'https://web.readest.com/api/crosspoint';
  // The key lives in a dotfile, which the device web server refuses to serve.
  // The account file records who is signed in and the ids of keys to revoke.
  const TOKEN_PATH = '/.crosspoint/.readest-token.json';
  const ACCOUNT_PATH = '/.crosspoint/readest-account.json';
  const NO_SYNC = { koServerUrl: '', koUsername: '', koPassword: '' };

  container.innerHTML =
    '<h2>Readest</h2>' +
    '<p data-status>Checking sign-in…</p>' +
    '<p data-code hidden>Open <a data-link target="_blank" rel="noopener"></a> ' +
    'and approve the code <b data-user-code></b>.</p>' +
    '<div class="setting-row" data-kosync-row><span class="setting-name">Sync reading progress<span data-kosync-note></span></span>' +
    '<span class="setting-control"><input type="checkbox" name="kosync" checked></span></div>' +
    '<div class="setting-row">' +
    '<button type="button" class="btn-small btn-add" name="signin">Sign in</button> ' +
    '<button type="button" class="btn-small" name="signout">Sign out</button>' +
    '</div>' +
    '<p style="color:#666">After you sign in, your Readest library appears on the reader under ' +
    'Plugins → Readest. With Sync reading progress on, KOReader Sync on the reader syncs your ' +
    'position with Readest.</p>';

  const $ = (selector) => container.querySelector(selector);
  const status = (text) => {
    $('[data-status]').textContent = text;
  };
  // Offer what applies now: Sign in, with the progress sync choice it applies,
  // while signed out; Sign out while signed in.
  const showSignedIn = (signedIn) => {
    $('[name="signin"]').style.display = signedIn ? 'none' : '';
    $('[data-kosync-row]').style.display = signedIn ? 'none' : '';
    $('[name="signout"]').style.display = signedIn ? '' : 'none';
  };
  // btoa() alone throws on characters outside Latin-1.
  const writeJson = (path, value) =>
    api.writeFile(
      path,
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))),
    );
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
  const syncsWithReadest = (settings) => settingValue(settings, 'koServerUrl') === API;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const relayJson = async (url, body) => {
    const res = await api.relay(
      'POST',
      url,
      { 'Content-Type': 'application/json' },
      JSON.stringify(body),
    );
    try {
      return { status: res.status, data: JSON.parse(res.body) };
    } catch {
      return { status: res.status, data: {} };
    }
  };
  // Returns the ids Readest could not be reached to revoke, to retry later.
  const revokeKeys = async (ids) => {
    const failed = [];
    for (const id of ids) {
      const res = await api.relay('DELETE', `${API}/keys/${id}`, {}, '').catch(() => null);
      if (res?.status !== 200) failed.push(id);
    }
    return failed;
  };

  let account = {};
  const saveAccount = async (value) => {
    account = value;
    await writeJson(ACCOUNT_PATH, value);
  };
  // Keys this page handed out that the next sign-in or sign-out revokes.
  const replacedKeys = () => [...(account.revoke ?? []), account.keyId].filter(Boolean);
  // Sign-in and sign-out change the reader's files one at a time.
  let queue = Promise.resolve();
  const exclusive = (fn) => (queue = queue.then(fn, fn));
  // Bumped by each sign-in and sign-out, so a sign-in still waiting for
  // approval gives up when another one starts or the user signs out.
  let attempt = 0;

  // Polls until the code is approved. Null when the sign-in was superseded.
  const waitForKey = async (code, current) => {
    let interval = (code.interval || 5) * 1000;
    const deadline = Date.now() + (code.expires_in || 600) * 1000;
    while (Date.now() < deadline) {
      await sleep(interval);
      if (current !== attempt) return null;
      const res = await relayJson(`${API}/device/token`, { device_code: code.device_code }).catch(
        () => null, // offline for a moment: keep polling
      );
      if (res?.data.access_token) return res.data;
      if (res?.data.error === 'slow_down') interval += 5000;
      if (res?.data.error === 'expired_token' || res?.data.error === 'access_denied') break;
    }
    throw new Error('the code expired');
  };

  const useKey = async (key, current) => {
    if (current !== attempt) {
      // Signed out while the code was being approved.
      const failed = await revokeKeys([key.id]);
      if (failed.length)
        await saveAccount({ ...account, revoke: [...(account.revoke ?? []), ...failed] });
      return;
    }
    const replaced = replacedKeys();
    // Recorded before the key is handed out, so a failure below can't leave a
    // key that nothing revokes.
    await saveAccount({ revoke: [...replaced, key.id] });
    await writeJson(TOKEN_PATH, { access_token: key.access_token });
    const settings = await readSettings();
    if ($('[name="kosync"]').checked) {
      await postSettings({
        koServerUrl: API,
        koUsername: key.username, // a label: the key alone authenticates
        koPassword: key.access_token,
        koMatchMethod: 1, // Binary: Readest identifies books by partial MD5
        koSyncBehavior: 1, // Smart
      });
    } else if (syncsWithReadest(settings)) {
      await postSettings(NO_SYNC);
    }
    await saveAccount({
      username: key.username,
      keyId: key.id,
      revoke: await revokeKeys(replaced),
    });
    status(`Signed in as ${key.username}.`);
    showSignedIn(true);
  };

  const signinButton = $('[name="signin"]');
  signinButton.onclick = async () => {
    const current = ++attempt;
    signinButton.disabled = true;
    try {
      const { status: httpStatus, data: code } = await relayJson(`${API}/device/code`, {});
      if (!code.device_code) throw new Error(`Readest is unreachable (HTTP ${httpStatus})`);
      $('[data-link]').href = code.verification_uri_complete;
      $('[data-link]').textContent = code.verification_uri;
      $('[data-user-code]').textContent = code.user_code;
      $('[data-code]').hidden = false;
      status('Waiting for approval…');
      const key = await waitForKey(code, current);
      if (key) await exclusive(() => useKey(key, current));
    } catch (e) {
      if (current === attempt) status(`Sign-in failed: ${e.message}`);
    } finally {
      $('[data-code]').hidden = true;
      signinButton.disabled = false;
    }
  };

  $('[name="signout"]').onclick = () => {
    attempt++;
    return exclusive(async () => {
      status('Signing out…');
      try {
        // Revoked first: a key left anywhere on the card is then useless.
        const failed = await revokeKeys(replacedKeys());
        await saveAccount(failed.length ? { revoke: failed } : {});
        // Signed out from here on: a reload shows Sign in even if the cleanup
        // below fails, so the buttons say so too.
        showSignedIn(false);
        await writeJson(TOKEN_PATH, {});
        if (syncsWithReadest(await readSettings())) await postSettings(NO_SYNC);
        status(
          failed.length
            ? 'Signed out. Readest could not be reached to revoke the key; the next sign-in or sign-out retries.'
            : 'Signed out.',
        );
      } catch (e) {
        status(`Error: ${e.message}`);
      }
    });
  };

  try {
    const res = await fetch(`/download?path=${encodeURIComponent(ACCOUNT_PATH)}`);
    account = res.ok ? await res.json() : {};
  } catch {
    account = {};
  }
  status(account.username ? `Signed in as ${account.username}.` : 'Not signed in.');
  showSignedIn(!!account.username);
  try {
    // Don't take over a KOReader Sync server the user set up without asking
    // (an empty URL with a username means CrossPoint's own sync server).
    const settings = await readSettings();
    const server = settingValue(settings, 'koServerUrl');
    if (settingValue(settings, 'koUsername') && server !== API) {
      $('[name="kosync"]').checked = false;
      $('[data-kosync-note]').textContent = ` (replaces ${server || 'the CrossPoint sync server'})`;
    }
  } catch {}
});
