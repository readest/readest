// run_cef.mjs SCENARIO OUT BINARY: play a parity scenario on Readest desktop (Linux CEF, release).
//
// Writes OUT/captures.jsonl (capture.js per step), OUT/timing.json and OUT/step-NNN.png (the
// viewport when the step was captured). The app runs under a scratch HOME in OUT/home and a
// private D-Bus session, with its DevTools endpoint on a local port, on its own Xvfb display at
// 96 DPI (device scale 1, as Readest Lite runs here), its window sized to the scenario's size.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [scenarioPath, out, binary] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(here, '../../readest-app/package.json'));
const { chromium } = require('playwright');
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const [w, h] = scenario.size ?? [1200, 800];
const delay = scenario.capture_ms ?? 2500;
const stepMs = scenario.step_ms ?? 3000;
const port = scenario.cdp_port ?? 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(`${out}/home`, { recursive: true });
// The window opens at the scenario's size: the window-state plugin restores this saved state
// (physical px, which are CSS px at device scale 1), so the book is never laid out at another size.
const configDir = `${out}/home/.config/com.bilingify.readest`;
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(`${configDir}/.window-state.json`, JSON.stringify({
  main: { width: w, height: h, x: 0, y: 0, prev_x: 0, prev_y: 0, maximized: false, visible: true, decorated: true, fullscreen: false },
}));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith('XDG_') || k === 'XDG_RUNTIME_DIR' || k === 'XDG_SESSION_TYPE'));
delete env.DBUS_SESSION_BUS_ADDRESS;
Object.assign(env, { HOME: path.resolve(`${out}/home`), READEST_CDP_PORT: String(port) });
// Offline, as Readest Lite is (it fetches nothing over the network): every http(s) request goes
// to a closed port, so web fonts fall back in both apps and the engines are compared alike.
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  env[k] = 'http://127.0.0.1:9';
}
env.no_proxy = env.NO_PROXY = '127.0.0.1,localhost';
// The scenario's `fonts` directory is the only one fontconfig sees (Readest Lite takes it as
// BLITZ_FONTS); the system's rules still apply, so Chromium's default "Times New Roman" and
// "Arial" find that directory's serif and sans-serif faces.
if (scenario.fonts) {
  fs.writeFileSync(`${out}/fonts.conf`, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir>${path.resolve(scenario.fonts)}</dir><cachedir>${path.resolve(out)}/fc-cache</cachedir>
<include ignore_missing="yes">/etc/fonts/conf.d</include></fontconfig>
`);
  env.FONTCONFIG_FILE = path.resolve(`${out}/fonts.conf`);
}
// Chromium reads the proxy from the environment only outside a known desktop session.
for (const k of ['DESKTOP_SESSION', 'GDMSESSION', 'GNOME_DESKTOP_SESSION_ID', 'KDE_FULL_SESSION']) delete env[k];
const display = `:${scenario.x_display ?? 97}`;
const xvfb = spawn('Xvfb', [display, '-screen', '0', '2400x1600x24', '-dpi', '96', '-nolisten', 'tcp'], { stdio: 'ignore' });
await sleep(1500);
delete env.WAYLAND_DISPLAY;
Object.assign(env, { DISPLAY: display, XDG_SESSION_TYPE: 'x11' });
const app = spawn('dbus-run-session', ['--', binary, ...(scenario.book ? [scenario.book] : [])], {
  env, stdio: ['ignore', 'ignore', fs.openSync(`${out}/stderr.log`, 'w')], detached: true,
});
const kill = () => {
  try { process.kill(-app.pid, 'SIGTERM'); } catch {}
  try { xvfb.kill(); } catch {}
};
process.on('exit', kill);

let browser;
for (let i = 0; i < 120 && !browser; i++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await sleep(500); }
}
if (!browser) throw new Error('no CDP endpoint');
let page;
for (let i = 0; i < 120 && !page; i++) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools'));
  if (!page) await sleep(500);
}
const cdp = await page.context().newCDPSession(page);
await page.waitForLoadState('load');
// The real window at the scenario's size (its inner size: Xvfb has no window manager).
const metrics = () => page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
console.error(`window at start: ${await metrics()}`);
for (let k = 0; k < 20; k++) {
  const [iw, ih, dpr] = await metrics();
  if (iw === w && ih === h && dpr === 1) break;
  await page.evaluate(([width, height]) => window.__TAURI_INTERNALS__.invoke('plugin:window|set_size',
    { label: 'main', value: { Logical: { width, height } } }), [w, h]).catch((e) => console.error(String(e)));
  await sleep(500);
}
const got = await metrics();
if (got[0] !== w || got[1] !== h || got[2] !== 1) throw new Error(`window is ${got}, wanted ${w}x${h}@1`);
// The app navigates while it starts (library, then the reader): a navigation drops what was
// evaluated in the page, so the capture script is put back whenever it is missing.
const scripts = fs.readFileSync(path.join(here, 'capture.js'), 'utf8') +
  (scenario.probe ? fs.readFileSync(scenario.probe, 'utf8') : '');
const inject = async () => {
  for (let k = 0; k < 20; k++) {
    try {
      if (!(await page.evaluate(() => typeof __parityCapture === 'function'))) await page.evaluate(scripts);
      return;
    } catch (e) {
      if (!/context was destroyed|navigation/i.test(String(e))) throw e;
      await sleep(500);
    }
  }
};
await inject();
// Per input: the next frame after it, and (in the reader) the frame after the relocate it causes.
await page.evaluate(() => {
  const t = (globalThis.__parityTiming = []);
  const onInput = () => {
    const e = { t0: performance.now() };
    t.push(e);
    requestAnimationFrame(() => requestAnimationFrame(() => { e.frame = performance.now() - e.t0; }));
  };
  document.addEventListener('keydown', onInput, true);
  document.addEventListener('pointerdown', onInput, true);
  let fv = null;
  setInterval(() => {
    const v = document.querySelector('foliate-view');
    if (!v || v === fv) return;
    fv = v;
    v.addEventListener('relocate', () => {
      const e = t.at(-1);
      if (!e || e.relocate != null) return;
      const at = performance.now() - e.t0;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        e.relocate = at; e.relocateFrame = performance.now() - e.t0;
      }));
    });
  }, 100);
});

const captures = [];
const capture = async (i) => {
  await inject();
  captures.push(await page.evaluate((s) => __parityCapture(s), i));
  // A clip at scale 1: CEF's own captures are at the display's device scale (1.59 here) and
  // cropped to the viewport's size, so they showed only its top-left part, enlarged.
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
  });
  fs.writeFileSync(`${out}/step-${String(i).padStart(3, '0')}.png`, Buffer.from(data, 'base64'));
};
const inputs = scenario.steps.filter((s) => !s.startsWith('wait:'));
let i = 0;
for (const s of scenario.steps) {
  if (s.startsWith('wait:')) { await sleep(Number(s.slice(5))); continue; }
  if (i === 0) await capture(0);
  i++;
  if (s.startsWith('key:')) await page.keyboard.press(s.slice(4));
  else if (/^\d+(\.\d+)?,\d+(\.\d+)?$/.test(s)) { const [x, y] = s.split(',').map(Number); await page.mouse.click(x, y); }
  else {
    const box = await page.locator(s).first().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else console.error(`step ${i}: ${s} not found`);
  }
  await sleep(delay);
  await capture(i);
  await sleep(Math.max(0, stepMs - delay));
}
if (inputs.length === 0) { await sleep(scenario.settle_ms ?? 8000); await capture(0); }
const timing = (await page.evaluate(() => globalThis.__parityTiming)).map((e, k) => ({
  step: k + 1, input: inputs[k], frame_ms: e.frame && +e.frame.toFixed(1),
  relocate_ms: e.relocate && +e.relocate.toFixed(1), relocate_frame_ms: e.relocateFrame && +e.relocateFrame.toFixed(1),
}));
fs.writeFileSync(`${out}/captures.jsonl`, captures.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(`${out}/timing.json`, JSON.stringify(timing, null, 1));
console.log(`cef: ${captures.length}/${inputs.length + 1} captures -> ${out}`);
await browser.close().catch(() => {});
kill();
process.exit(0);
