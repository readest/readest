// node cdp.mjs '<async js body>'|FILE — raw CDP Runtime.evaluate on a WebView page target.
// Android WebView needs raw CDP: Playwright's connectOverCDP fails there (no browser contexts).
// Env: CDP_PORT (default 9256), PAGE_MATCH (substring of the page URL).
import fs from 'node:fs';
const port = process.env.CDP_PORT || '9256';
const arg = process.argv[2];
const expr = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = targets.filter((x) => x.type === 'page');
const t = pages.find((x) => x.url.includes(process.env.PAGE_MATCH || '')) ?? pages[0];
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const res = await send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
if (res.result?.exceptionDetails) console.log('EXC', JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails).slice(0, 600));
else console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 1));
ws.close();
process.exit(0);
