#!/usr/bin/env node
// Talk to the running app over the Chrome DevTools Protocol.
//
// Only the Linux CEF build exposes a CDP endpoint, and only when it was started
// with a port: `pnpm tauri:dev:cdp`, or `READEST_CDP_PORT=9222` on any CEF
// build (see docs/testing.md). Everything here is plain node — the global
// `fetch` and `WebSocket` are all a CDP client needs.
//
//   pnpm cdp targets
//   pnpm cdp eval 'document.title'
//   pnpm cdp eval 'window.__TAURI_INTERNALS__.invoke("plugin:app|version")'
//   pnpm cdp click 'button[aria-label="Import Books"]'
//   pnpm cdp screenshot /tmp/library.png
//   pnpm cdp logs 30
//
// CDP_PORT overrides the default 9222.
const PORT = process.env['CDP_PORT'] ?? '9222';
const BASE = `http://127.0.0.1:${PORT}`;

const die = (message) => {
  console.error(message);
  process.exit(1);
};

const listTargets = async () => {
  try {
    return await (await fetch(`${BASE}/json/list`)).json();
  } catch {
    return die(
      `No CDP endpoint on ${BASE}. Start the app with \`pnpm tauri:dev:cdp\` ` +
        '(or READEST_CDP_PORT=<port> on a CEF build).',
    );
  }
};

// The app window is the only http(s) target; chrome:// targets are CEF's own UI.
const appTarget = async () => {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && /^https?:/.test(t.url));
  return page ?? die('No app page target found. Is the window open?');
};

const connect = async () => {
  const ws = new WebSocket((await appTarget()).webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('websocket failed')));
  });
  let lastId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method) {
      for (const listener of listeners) listener(data);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      // A pending timer keeps node's event loop alive, so it has to be cleared
      // once the reply lands: otherwise the command prints its answer and then
      // sits there for the rest of the 30s before the process can exit.
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: timed out`));
      }, 30000);
      pending.set(id, (m) => {
        clearTimeout(timeout);
        if (m.error) reject(new Error(`${method}: ${JSON.stringify(m.error)}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  };
  return { send, evaluate, on: (fn) => listeners.add(fn), close: () => ws.close() };
};

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'targets': {
    for (const t of await listTargets()) console.log(`${t.type}\t${t.url}\t${t.title}`);
    break;
  }

  case 'eval': {
    if (!args[0]) die("usage: pnpm cdp eval '<javascript>'");
    const cdp = await connect();
    const value = await cdp.evaluate(args[0]);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    cdp.close();
    break;
  }

  // A real mouse press at the element's center: menus and dropdowns that key off
  // pointer events ignore an `element.click()` from `eval`.
  case 'click': {
    if (!args[0]) die("usage: pnpm cdp click '<css selector>'");
    const cdp = await connect();
    const box = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(args[0])});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!box) die(`No element matches ${args[0]}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: type === 'mouseMoved' ? 0 : 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    console.log(`clicked ${args[0]}`);
    cdp.close();
    break;
  }

  case 'screenshot': {
    const out = args[0] ?? 'cdp-screenshot.png';
    const cdp = await connect();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(out);
    cdp.close();
    break;
  }

  // Console output of the running app, including whatever it logged before we
  // attached (Runtime.enable replays the buffer).
  case 'logs': {
    const seconds = Number(args[0] ?? 10);
    const cdp = await connect();
    cdp.on(({ method, params }) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = params.args
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ');
        console.log(`[${params.type}] ${text}`);
      } else if (method === 'Runtime.exceptionThrown') {
        console.log(`[error] ${params.exceptionDetails.exception?.description ?? ''}`);
      }
    });
    await cdp.send('Runtime.enable');
    setTimeout(() => {
      cdp.close();
      process.exit(0);
    }, seconds * 1000);
    break;
  }

  default:
    die('usage: pnpm cdp <targets|eval|click|screenshot|logs> [args]');
}
