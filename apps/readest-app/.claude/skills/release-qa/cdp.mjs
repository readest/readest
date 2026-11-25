// node cdp.mjs '<async js body>'|FILE — raw CDP Runtime.evaluate on a WebView page target.
// Android WebView needs raw CDP: Playwright's connectOverCDP fails there (no browser contexts).
// Env: CDP_PORT (default 9256), PAGE_MATCH (substring of the page URL).
import fs from 'node:fs';
const port = process.env.CDP_PORT || '9256';
const arg = process.argv[2];
const expr = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = targets.filter((x) => x.type === 'page');
// An explicit PAGE_MATCH must match: falling back to another page would run the code there.
const want = process.env.PAGE_MATCH;
const t = want ? pages.find((x) => x.url.includes(want)) : pages[0];
if (!t) { console.error(`no page matches PAGE_MATCH=${want ?? ''}:`, pages.map((x) => x.url).join(' | ')); process.exit(1); }
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
const failed = Boolean(res.error || res.result?.exceptionDetails);
if (res.error) console.log('ERR', JSON.stringify(res.error).slice(0, 600));
else if (res.result.exceptionDetails) console.log('EXC', JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails).slice(0, 600));
else console.log(JSON.stringify(res.result.result?.value ?? res.result, null, 1));
ws.close();
process.exit(failed ? 1 : 0);
