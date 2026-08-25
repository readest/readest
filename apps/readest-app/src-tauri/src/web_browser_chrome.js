// Desktop in-app browser chrome (#5775). Injected into every page of a
// `browser-*` window by `web_browser.rs`, which replaces the placeholder
// identifier below with the JSON options (theme colours + translated labels).
(function (OPTIONS) {
  if (window.top !== window) return;
  if (window.__readestBrowser) return;

  var L = OPTIONS.labels || {};
  var BG = OPTIONS.background || '#1f2024';
  var FG = OPTIONS.foreground || '#f5f5f7';
  var EINK = !!OPTIONS.isEink;
  var SENTINEL = 'https://readest-browser.invalid/';

  function label(key, fallback) {
    return L[key] || fallback;
  }

  var state = { hideTimer: null };
  var refs = {};

  function css() {
    return (
      ':host{all:initial;}' +
      '.pill{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;' +
      'display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:999px;' +
      'box-sizing:border-box;max-width:calc(100vw - 24px);' +
      'background:' +
      BG +
      ';color:' +
      FG +
      ';font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'border:1px solid ' +
      (EINK ? FG : 'rgba(128,128,128,.35)') +
      ';' +
      (EINK ? '' : 'box-shadow:0 4px 16px rgba(0,0,0,.18);') +
      'direction:ltr;user-select:none;-webkit-user-select:none;}' +
      '.btn{appearance:none;border:0;background:transparent;color:' +
      FG +
      ';width:32px;height:32px;border-radius:999px;' +
      'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;padding:0;margin:0;flex:none;}' +
      '.btn:hover{background:rgba(128,128,128,.18);}' +
      '.status{display:none;align-items:center;gap:8px;padding:0 8px;min-width:0;flex:0 1 auto;}' +
      '.status.show{display:inline-flex;}' +
      '.status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto;}' +
      '.open{appearance:none;border:0;border-radius:999px;padding:4px 12px;flex:none;white-space:nowrap;background:' +
      FG +
      ';color:' +
      BG +
      ';font-weight:600;cursor:pointer;}' +
      '.sep{width:1px;height:20px;background:rgba(128,128,128,.35);margin:0 2px;}'
    );
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(key, glyph, fallback, onClick) {
    var b = el('button', 'btn', glyph);
    b.type = 'button';
    b.setAttribute('aria-label', label(key, fallback));
    b.title = label(key, fallback);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  function navigate(path) {
    location.href = SENTINEL + path;
  }

  function install() {
    if (refs.host || !document.documentElement) return;
    var host = el('div');
    host.id = '__readest_browser_chrome__';
    var root = host.attachShadow({ mode: 'closed' });
    var style = el('style', null, css());
    var pill = el('div', 'pill');
    pill.setAttribute('role', 'toolbar');

    refs.back = button('back', '‹', 'Back', function () {
      history.back();
    });
    refs.forward = button('forward', '›', 'Forward', function () {
      history.forward();
    });
    refs.reload = button('reload', '↻', 'Reload', function () {
      location.reload();
    });
    refs.status = el('span', 'status');
    refs.statusText = el('span', 'status-text');
    refs.open = el('button', 'open', label('open', 'Open'));
    refs.open.type = 'button';
    refs.open.hidden = true;
    refs.status.appendChild(refs.statusText);
    refs.status.appendChild(refs.open);
    refs.close = button('close', '×', 'Close', function () {
      navigate('close');
    });

    pill.appendChild(refs.back);
    pill.appendChild(refs.forward);
    pill.appendChild(refs.reload);
    pill.appendChild(refs.status);
    pill.appendChild(el('span', 'sep'));
    pill.appendChild(refs.close);
    root.appendChild(style);
    root.appendChild(pill);
    (document.body || document.documentElement).appendChild(host);
    refs.host = host;
  }

  function scheduleHide() {
    state.hideTimer = setTimeout(function () {
      refs.status.classList.remove('show');
    }, 8000);
  }

  function setStatus(status) {
    install();
    if (!refs.status) return;
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
    var fallback = {
      downloading: 'Downloading',
      importing: 'Importing',
      added: 'Added to library',
      failed: 'Import failed',
      unsupported: 'Not a supported book format',
    };
    var text = label(status.state, fallback[status.state] || status.state);
    if (status.filename) text += ' · ' + status.filename;
    refs.statusText.textContent = text;
    refs.status.classList.add('show');
    if (status.state === 'added' && status.bookHash) {
      refs.open.hidden = false;
      refs.open.onclick = function () {
        navigate('open/' + encodeURIComponent(status.bookHash));
      };
      scheduleHide();
    } else {
      refs.open.hidden = true;
      refs.open.onclick = null;
      if (status.state !== 'downloading' && status.state !== 'importing') scheduleHide();
    }
  }

  window.addEventListener(
    'keydown',
    function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === '[') {
        e.preventDefault();
        history.back();
      } else if (mod && e.key === ']') {
        e.preventDefault();
        history.forward();
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        history.back();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        history.forward();
      } else if (mod && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        location.reload();
      } else if (mod && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        navigate('close');
      } else if (e.key === 'Escape') {
        window.stop();
      }
    },
    true,
  );

  window.__readestBrowser = { setStatus: setStatus };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(__READEST_BROWSER_OPTIONS__);
