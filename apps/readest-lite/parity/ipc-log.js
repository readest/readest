// Logs each Tauri command the page calls and how it ended: `PARITY-IPC {"cmd","ok","error"}`.
// invoke() is read-only, but it sends every command as a fetch() to Tauri's ipc protocol, which
// answers with a Tauri-Response header: ok, or the error ("Command x not found", "... not allowed
// by ACL", or the command's own). The same in Readest Lite and Readest desktop.
(() => {
  const fetch0 = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    const m = /^(?:ipc:\/\/localhost|https?:\/\/ipc\.localhost)\/([^?#]+)/.exec(url);
    const res = await fetch0.call(this, input, init);
    if (m) {
      const ok = res.headers.get('Tauri-Response') === 'ok';
      const error = ok
        ? null
        : (
            await res
              .clone()
              .text()
              .catch(() => '')
          ).slice(0, 200);
      console.log('PARITY-IPC ' + JSON.stringify({ cmd: decodeURIComponent(m[1]), ok, error }));
    }
    return res;
  };
})();
