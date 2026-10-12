// The dashboard page and its script, served by index.ts. The script polls
// /api/state and builds the DOM with textContent only (worker names and
// versions come from workers).

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Readest Voice Workers</title>
<style>
:root {
  --bg: #f4f6f8; --panel: #ffffff; --ink: #18202b; --muted: #5b6676; --rule: #dde2e8;
  --accent: #2753c7; --ok: #1f7a4d; --ok-bg: #e2f3ea; --warn: #8a5a00; --warn-bg: #fbf0d6;
  --bad: #b3261e; --bad-bg: #fbe4e2; --busy-bg: #e3eafb; --off-bg: #eceff3;
  --ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1318; --panel: #161b22; --ink: #e3e8ee; --muted: #93a0af; --rule: #29313b;
    --accent: #8ea8ff; --ok: #6fd3a0; --ok-bg: #133325; --warn: #f0c060; --warn-bg: #3a2c0c;
    --bad: #ff8a80; --bad-bg: #3d1614; --busy-bg: #1d2944; --off-bg: #222932;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--ui); padding-inline: 16px; padding-block: 24px 48px; }
main { max-width: 1180px; margin: 0 auto; display: grid; gap: 24px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 8px 24px; }
h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
h2 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.sub, .meta { color: var(--muted); font-size: 13px; }
.meta { text-align: right; }
.banner { padding: 10px 14px; border-radius: 6px; background: var(--bad-bg); color: var(--bad); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
.stat { padding: 14px 16px; display: grid; gap: 2px; box-shadow: 1px 0 0 var(--rule), 0 1px 0 var(--rule); }
.stat b { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 12px; }
section { display: grid; gap: 10px; }
.panel { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--rule); white-space: nowrap; vertical-align: middle; }
th { font-size: 12px; font-weight: 600; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; }
.name { font-weight: 600; }
.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--rule); border-radius: 999px; padding: 0 6px; margin-left: 6px; }
.mono { font-family: var(--mono); font-size: 12px; }
.pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 9px; border-radius: 999px; }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.busy { background: var(--busy-bg); color: var(--accent); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.off { background: var(--off-bg); color: var(--muted); }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); cursor: pointer; }
button:hover { border-color: var(--muted); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.danger { color: var(--bad); }
button.danger.armed { background: var(--bad); color: var(--panel); border-color: var(--bad); }
button.primary { background: var(--accent); color: var(--panel); border-color: var(--accent); }
form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 14px 16px; }
input { font: inherit; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--rule); background: var(--bg); color: var(--ink); min-width: 0; width: 220px; max-width: 100%; }
.hint { color: var(--muted); font-size: 12px; }
.error { color: var(--bad); font-size: 13px; }
.reveal { padding: 14px 16px; display: grid; gap: 10px; border-top: 1px solid var(--rule); }
.reveal pre { margin: 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; overflow-x: auto; font: 12px/1.6 var(--mono); white-space: pre; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.empty { padding: 16px; color: var(--muted); }
footer { color: var(--muted); font-size: 12px; max-width: 80ch; display: grid; gap: 4px; }
footer p { margin: 0; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Readest Voice workers</h1>
      <div class="sub" id="required"></div>
    </div>
    <div class="meta"><div id="admin"></div><div id="updated">Loading…</div></div>
  </header>
  <div class="banner" id="banner" hidden></div>
  <div class="stats" id="stats"></div>
  <section>
    <h2>Workers</h2>
    <div class="panel scroll"><table id="workers"></table></div>
  </section>
  <section>
    <h2>Add a worker</h2>
    <div class="panel">
      <form id="add">
        <input id="name" name="name" autocomplete="off" spellcheck="false" placeholder="e.g. gpu-box-2" pattern="[a-z0-9][a-z0-9\\-]{0,31}" required aria-label="Worker name">
        <button class="primary" type="submit">Add worker</button>
        <span class="hint">Lowercase letters, digits and dashes. The token is shown once.</span>
        <span class="error" id="add-error" role="alert"></span>
      </form>
      <div class="reveal" id="reveal" hidden>
        <div class="row"><strong id="reveal-title"></strong><span class="hint">Copy it now: it is not stored and cannot be shown again.</span></div>
        <pre id="token"></pre>
        <div class="row"><button type="button" id="copy-token">Copy token</button></div>
        <div class="hint">Start it on a machine with an NVIDIA GPU (GTX 10-series cards need the image built from Dockerfile.pascal):</div>
        <pre id="command"></pre>
        <div class="row"><button type="button" id="copy-command">Copy command</button><button type="button" id="done">Done</button></div>
      </div>
    </div>
  </section>
  <section>
    <h2>Download queue by engine</h2>
    <div class="panel scroll"><table id="engines"></table></div>
  </section>
  <footer>
    <p>Pause lets a worker finish the jobs it holds and take no new ones. Pausing the RunPod bridge leaves downloads to the pull workers.</p>
    <p>Remove revokes a dashboard token at once and puts its jobs back in the queue. Workers whose token is in the READEST_VOICE_WORKER_TOKENS secret come back while the secret still lists them.</p>
  </footer>
</main>
<script src="/app.js" defer></script>
</body>
</html>
`;

export const APP_JS = `'use strict';
(function () {
  var REFRESH_MS = 5000;
  var ONLINE_MS = 60000;
  var state = null;
  var fetchedAt = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function ago(t, now) {
    if (t == null) return 'never';
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function duration(ms) {
    var s = Math.round(ms / 1000);
    return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h';
  }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }

  function status(w, now) {
    if (w.source === 'bridge') {
      if (!state.bridge.configured) return ['Not configured', 'off'];
      if (w.paused) return w.running ? ['Draining', 'warn'] : ['Paused', 'warn'];
      return w.running ? ['Running ' + w.running, 'busy'] : ['Ready', 'ok'];
    }
    if (w.paused) return w.running ? ['Draining', 'warn'] : ['Paused', 'warn'];
    if (w.rejected) return ['Needs ' + (state.requiredVersion || 'upgrade'), 'bad'];
    if (w.running) return ['Busy', 'busy'];
    if (w.lastSeen != null && now - w.lastSeen < ONLINE_MS) return w.waiting ? ['Waiting', 'ok'] : ['Online', 'ok'];
    return [w.lastSeen == null ? 'Not seen yet' : 'Offline', 'off'];
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
        return data;
      });
    });
  }

  function stat(value, label) {
    var d = el('div', null, 'stat');
    d.append(el('b', value), el('span', label));
    return d;
  }

  function renderStats(s) {
    var q = s.queue;
    var stats = $('stats');
    stats.replaceChildren(
      stat(num(q.queued), 'downloads queued'),
      stat(q.oldestQueuedAt ? duration(s.now - q.oldestQueuedAt) : '–', 'oldest waiting'),
      stat(num(q.leased), 'downloads running'),
      stat(s.slots.listen + ' / ' + s.slots.capacity, 'RunPod slots listening'),
      stat(s.slots.download, 'RunPod slots downloading')
    );
  }

  function actionButtons(w) {
    var box = el('div', null, 'actions');
    if (w.source === 'bridge' && !state.bridge.configured) return box;
    var pause = el('button', w.paused ? 'Resume' : 'Pause');
    pause.type = 'button';
    pause.addEventListener('click', function () {
      pause.disabled = true;
      api('POST', '/api/workers/' + encodeURIComponent(w.name) + '/pause', { paused: !w.paused })
        .then(load, showError);
    });
    box.append(pause);
    if (w.source !== 'bridge') {
      var remove = el('button', 'Remove', 'danger');
      remove.type = 'button';
      var timer = 0;
      remove.addEventListener('click', function () {
        if (!remove.classList.contains('armed')) {
          remove.classList.add('armed');
          remove.textContent = 'Confirm remove';
          timer = setTimeout(function () { remove.classList.remove('armed'); remove.textContent = 'Remove'; }, 4000);
          return;
        }
        clearTimeout(timer);
        remove.disabled = true;
        api('DELETE', '/api/workers/' + encodeURIComponent(w.name)).then(load, showError);
      });
      box.append(remove);
    }
    return box;
  }

  function renderWorkers(s) {
    var table = $('workers');
    var head = el('tr');
    ['Status', 'Worker', 'Engines', 'Version', 'Waiting', 'Running', 'Done', 'Lost', 'Characters', 'Last seen', ''].forEach(function (h, i) {
      head.append(el('th', h, i >= 4 && i <= 8 ? 'num' : null));
    });
    var rows = [el('thead')];
    rows[0].append(head);
    var body = el('tbody');
    var workers = s.workers.slice().sort(function (a, b) {
      if ((a.source === 'bridge') !== (b.source === 'bridge')) return a.source === 'bridge' ? 1 : -1;
      return a.name < b.name ? -1 : 1;
    });
    if (!workers.length) {
      var tr = el('tr');
      var td = el('td', 'No workers yet. Add one below, or start a worker whose token is in the secret.', 'empty');
      td.colSpan = 11;
      tr.append(td);
      body.append(tr);
    }
    workers.forEach(function (w) {
      var st = status(w, s.now);
      var tr = el('tr');
      var pill = el('td');
      pill.append(el('span', st[0], 'pill ' + st[1]));
      var name = el('td');
      name.append(el('span', w.name, 'name'), el('span', w.source === 'bridge' ? 'RunPod' : w.source === 'secret' ? 'secret token' : 'dashboard', 'tag'));
      tr.append(
        pill,
        name,
        el('td', w.source === 'bridge' ? 'all' : (w.engines.join(', ') || '–'), 'mono'),
        el('td', w.version || '–', 'mono'),
        el('td', w.source === 'bridge' ? '–' : w.waiting, 'num'),
        el('td', w.running, 'num'),
        el('td', num(w.done), 'num'),
        el('td', num(w.lost), 'num'),
        el('td', num(w.chars), 'num'),
        el('td', ago(w.lastSeen, s.now))
      );
      var actions = el('td');
      actions.append(actionButtons(w));
      tr.append(actions);
      body.append(tr);
    });
    rows.push(body);
    table.replaceChildren.apply(table, rows);
  }

  function renderEngines(s) {
    var table = $('engines');
    var head = el('tr');
    head.append(el('th', 'Engines needed'), el('th', 'Queued', 'num'), el('th', 'Running', 'num'));
    var thead = el('thead');
    thead.append(head);
    var body = el('tbody');
    var keys = Object.keys(s.queue.engines).sort();
    if (!keys.length) {
      var tr = el('tr');
      var td = el('td', 'No downloads queued or running.', 'empty');
      td.colSpan = 3;
      tr.append(td);
      body.append(tr);
    }
    keys.forEach(function (k) {
      var tr = el('tr');
      tr.append(el('td', k.split('+').join(' + '), 'mono'), el('td', num(s.queue.engines[k].queued), 'num'), el('td', num(s.queue.engines[k].leased), 'num'));
      body.append(tr);
    });
    table.replaceChildren(thead, body);
  }

  function render() {
    if (!state) return;
    $('required').textContent = state.requiredVersion
      ? 'Downloads need worker version ' + state.requiredVersion
      : 'Any worker version is accepted';
    $('admin').textContent = state.admin ? 'Signed in as ' + state.admin : '';
    renderStats(state);
    renderWorkers(state);
    renderEngines(state);
  }

  function showError(err) {
    var banner = $('banner');
    banner.textContent = 'Could not reach the dispatcher: ' + (err && err.message ? err.message : err) + '. Retrying.';
    banner.hidden = false;
  }

  function load() {
    return api('GET', '/api/state').then(function (s) {
      state = s;
      fetchedAt = Date.now();
      $('updated').textContent = 'Updated just now';
      $('banner').hidden = true;
      render();
    }, showError);
  }

  setInterval(function () {
    if (fetchedAt) $('updated').textContent = 'Updated ' + ago(fetchedAt, Date.now());
  }, 1000);
  setInterval(load, REFRESH_MS);
  load();

  function copy(text, button) {
    var label = button.textContent;
    navigator.clipboard.writeText(text).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; }, 1500);
    }, function () { button.textContent = 'Select and copy'; });
  }

  var ERRORS = {
    INVALID_NAME: 'Use lowercase letters, digits and dashes, starting with a letter or digit (up to 32).',
    NAME_TAKEN: 'That name is taken.',
  };

  $('add').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = $('name');
    var name = input.value.trim();
    $('add-error').textContent = '';
    api('POST', '/api/workers', { name: name }).then(function (res) {
      input.value = '';
      var image = 'ghcr.io/readest/readest-voice:' + (state && state.requiredVersion ? state.requiredVersion : '<version>');
      $('reveal-title').textContent = 'Token for ' + res.name;
      $('token').textContent = res.token;
      $('command').textContent = [
        'docker run -d --name readest-voice-pull --gpus all --restart unless-stopped \\\\',
        '  -e READEST_VOICE_MODE=pull \\\\',
        '  -e READEST_VOICE_API=https://web.readest.com/api \\\\',
        '  -e READEST_VOICE_WORKER_TOKEN=' + res.token + ' \\\\',
        '  -e TTS_CONCURRENCY=2 \\\\',
        '  ' + image,
      ].join('\\n');
      $('reveal').hidden = false;
      load();
    }, function (err) {
      $('add-error').textContent = ERRORS[err.message] || 'Could not add the worker: ' + err.message;
    });
  });
  $('copy-token').addEventListener('click', function (e) { copy($('token').textContent, e.currentTarget); });
  $('copy-command').addEventListener('click', function (e) { copy($('command').textContent, e.currentTarget); });
  $('done').addEventListener('click', function () {
    $('reveal').hidden = true;
    $('token').textContent = '';
    $('command').textContent = '';
  });
})();
`;
