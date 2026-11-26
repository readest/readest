// run_cef.mjs SCENARIO OUT BINARY: play a parity scenario on Readest desktop (Linux CEF, release).
//
// Writes OUT/captures.jsonl (capture.js per step), OUT/timing.json, OUT/ipc.json (every Tauri
// command called, and how it ended: ipc-log.js) and OUT/step-NNN.png (the viewport when the step
// was captured). The app runs under a scratch HOME in OUT/home and a private D-Bus session, with
// its DevTools endpoint on a local port, on its own Xvfb display at the scenario's device scale
// (GDK_SCALE), its window sized to the scenario's size. With PARITY_BACKEND (backend.py's DIR) the
// app uses that server, signed in; with PARITY_HOME (a previous run's OUT/home) it starts on a copy
// of that home, as after a restart.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [scenarioPath, out, binary] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(here, '../../readest-app/package.json'));
const { chromium } = require('playwright');
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const [w, h] = scenario.size ?? [1200, 800]; // CSS px
const scale = scenario.scale ?? 1; // device px per CSS px (the Kindle Voyage: 536x724 at 2)
const delay = scenario.capture_ms ?? 2500;
const stepMs = scenario.step_ms ?? 3000;
const port = scenario.cdp_port ?? 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(out, { recursive: true, force: true });
const restart = process.env.PARITY_HOME;
if (restart) fs.cpSync(restart, `${out}/home`, { recursive: true, verbatimSymlinks: true });
fs.mkdirSync(`${out}/home`, { recursive: true });
// The window opens at the scenario's size: the window-state plugin restores this saved state
// (physical px), so the book is never laid out at another size.
// CEF keeps the page's profile (its localStorage among it) in a folder named after the data
// directory's absolute path (tauri-runtime-cef, request_context.rs): a copied home gets that name.
const home = path.resolve(`${out}/home`);
const cefDir = `${home}/.cache/com.bilingify.readest/cef`;
const dataDir = `${home}/.local/share/com.bilingify.readest`;
const profileDir = `${cefDir}/Profile-${createHash('sha256').update(dataDir).digest().subarray(0, 16).toString('base64url')}`;
for (const d of restart && fs.existsSync(cefDir) ? fs.readdirSync(cefDir) : []) {
  if (d.startsWith('Profile-') && `${cefDir}/${d}` !== profileDir) fs.renameSync(`${cefDir}/${d}`, profileDir);
}
// A local server is on loopback, which Chromium lets http://tauri.localhost reach only once allowed.
// Readest allows it itself since #7525 (src-tauri/src/cef_local_network.rs), with this same setting.
if (process.env.PARITY_BACKEND) {
  const prefsPath = `${profileDir}/Preferences`;
  const prefs = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, 'utf8')) : {};
  const exceptions = (((prefs.profile ??= {}).content_settings ??= {}).exceptions ??= {});
  (exceptions.loopback_network ??= {})['http://tauri.localhost:80,*'] = { setting: 1 };
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
}
const configDir = `${out}/home/.config/com.bilingify.readest`;
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(`${configDir}/.window-state.json`, JSON.stringify({
  main: { width: w * scale, height: h * scale, x: 0, y: 0, prev_x: 0, prev_y: 0, maximized: false, visible: true, decorated: true, fullscreen: false },
}));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith('XDG_') || k === 'XDG_RUNTIME_DIR' || k === 'XDG_SESSION_TYPE'));
delete env.DBUS_SESSION_BUS_ADDRESS;
Object.assign(env, { HOME: path.resolve(`${out}/home`), READEST_CDP_PORT: String(port) });
// A real device scale, as on the Kindle: Chromium lays out in device px at it and snaps boxes to
// device px. (Emulation.setDeviceMetricsOverride's scale snaps them to CSS px instead.)
env.GDK_SCALE = String(scale);
delete env.GDK_DPI_SCALE;
// Offline but for the hosts a scenario lists as `online` (a dictionary's): every other http(s)
// request goes to a closed port, so web fonts fall back in both apps (Readest Lite loads none)
// and the engines are compared alike.
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  env[k] = 'http://127.0.0.1:9';
}
env.no_proxy = env.NO_PROXY = ['127.0.0.1', 'localhost', ...(scenario.online ?? [])].join(',');
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
// The page as Readest Lite starts it: one window (books open in it) and, for `eink`, Readest's
// e-ink mode (src-tauri/src/main.rs's initialization script); and the book, as Readest hands a
// file it was started with to the page (OPEN_WITH_FILES): the restart below drops what it handed
// the first start. (CEF serves the app's pages itself, so they can't be swapped for Readest Lite's
// dist/: compare a Readest built from the same readest-app export.)
// Every Tauri command the page calls, and how it ended (ipc-log.js; run_lite.py logs the same).
const ipc = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('PARITY-IPC ')) ipc.push(JSON.parse(t.slice('PARITY-IPC '.length)));
});
await page.addInitScript({ content: fs.readFileSync(path.join(here, 'ipc-log.js'), 'utf8') });
if (process.env.PARITY_BACKEND) {
  const init = spawnSync('python3', [path.join(here, 'backend.py'), 'init', process.env.PARITY_BACKEND, 'cef'], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`backend.py init: ${init.stderr}`);
  await page.addInitScript({ content: init.stdout });
}
await page.addInitScript({
  content: `window.__READEST_SINGLE_WINDOW = true;${scenario.eink ? ' window.__READEST_IS_EINK = true;' : ''}` +
    (scenario.book ? ` window.OPEN_WITH_FILES = ${JSON.stringify([path.resolve(scenario.book)])};` : ''),
});
// The app's first start, before the flags above, saved its settings (e-ink mode off): start it
// again on a blank profile. A restart keeps what the earlier run left; its first start ran without
// the backend's config, so the sign-in it saw was the one the build points at, which it can't
// reach (the proxy above): supabase-js keeps the backend's session, which the start below finds.
const startUrl = page.url();
await page.goto('about:blank');
if (!restart) {
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(startUrl).origin, storageTypes: 'all' });
  for (const f of ['settings.json', 'settings.json.bak']) fs.rmSync(`${configDir}/${f}`, { force: true });
  // The scenario's saved settings (run_lite.py starts Readest Lite with the same).
  if (scenario.settings) fs.writeFileSync(`${configDir}/settings.json`, JSON.stringify(scenario.settings));
  fs.rmSync(`${out}/home/.local/share/com.bilingify.readest/Readest`, { recursive: true, force: true });
}
await page.goto(startUrl);
await page.waitForLoadState('load');
// The app navigates while it starts (library, then the reader), which drops what an evaluation
// was running: evaluations are retried across navigations.
const evaluate = async (fn, arg) => {
  for (let k = 0; ; k++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (k >= 20 || !/context was destroyed|navigation/i.test(String(e))) throw e;
      await sleep(500);
    }
  }
};
// The real window at the scenario's size (its inner size: Xvfb has no window manager).
const metrics = () => evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
console.error(`window at start: ${await metrics()}`);
for (let k = 0; k < 20; k++) {
  const [iw, ih, dpr] = await metrics();
  if (iw === w && ih === h && dpr === scale) break;
  await evaluate(([width, height]) => window.__TAURI_INTERNALS__.invoke('plugin:window|set_size',
    { label: 'main', value: { Logical: { width, height } } }), [w, h]).catch((e) => console.error(String(e)));
  await sleep(500);
}
const got = await metrics();
if (got[0] !== w || got[1] !== h || got[2] !== scale) throw new Error(`window is ${got}, wanted ${w}x${h}@${scale}`);
// The app navigates while it starts (library, then the reader): a navigation drops what was
// evaluated in the page, so the capture script is put back whenever it is missing.
// `text:Label` taps the element showing Label (text-steps.js tags it).
const texts = scenario.steps.filter((s) => s.startsWith('text:')).map((s) => s.slice(5));
const steps = scenario.steps.map((s) => (s.startsWith('text:') ? `[data-parity-text="${s.slice(5)}"]` : s));
const scripts = fs.readFileSync(path.join(here, 'capture.js'), 'utf8') +
  fs.readFileSync(path.join(here, 'text-steps.js'), 'utf8') +
  (scenario.probe ? fs.readFileSync(scenario.probe, 'utf8') : '') +
  `\n__parityTexts(${JSON.stringify(texts)});\n`;
const inject = async () => {
  if (!(await evaluate(() => typeof __parityCapture === 'function'))) await evaluate(scripts);
};
await inject();
// Per input: the next frame after it, and (in the reader) the frame after the relocate it causes.
await evaluate(() => {
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
  // A navigation between injecting the script and calling it drops it again.
  for (let k = 0; ; k++) {
    await inject();
    try {
      captures.push(await evaluate((s) => __parityCapture(s), i));
      break;
    } catch (e) {
      if (k >= 5 || !/__parityCapture is not defined/.test(String(e))) throw e;
    }
  }
  // A clip at scale 1: CEF's own captures are at the display's device scale (1.59 here) and
  // cropped to the viewport's size, so they showed only its top-left part, enlarged.
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, // w*scale x h*scale px
  });
  fs.writeFileSync(`${out}/step-${String(i).padStart(3, '0')}.png`, Buffer.from(data, 'base64'));
};
const inputs = steps.filter((s) => !s.startsWith('wait:'));
let i = 0;
for (const s of steps) {
  if (s.startsWith('wait:')) { await sleep(Number(s.slice(5))); continue; }
  if (i === 0) await capture(0);
  i++;
  // `2x:` before a target: a double click (Lite: a double tap); `hold:`, a finger held on it
  // 700 ms (a long press); `select:X,Y>X2,Y2`, a mouse drag from one point to the other (Lite: a
  // long press dragged there, its way to select on a touch screen).
  const t = s.replace(/^(2x|hold|select):/, '');
  const hold = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const click = (x, y) =>
    t === s ? page.mouse.click(x, y) : s.startsWith('hold:') ? hold(x, y) : page.mouse.dblclick(x, y);
  if (s.startsWith('key:')) await page.keyboard.press(s.slice(4));
  else if (s.startsWith('select:')) {
    const [[ax, ay], [bx, by]] = t.split('>').map((p) => p.split(',').map(Number));
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(bx, by, { steps: 8 });
    await page.mouse.up();
  }
  else if (/^\d+(\.\d+)?,\d+(\.\d+)?$/.test(t)) { const [x, y] = t.split(',').map(Number); await click(x, y); }
  else {
    if (t.startsWith('[data-parity-text=')) await evaluate(() => globalThis.__parityTag?.());
    const box = await page.locator(t).first().boundingBox({ timeout: 5000 }).catch(() => null);
    if (box) await click(box.x + box.width / 2, box.y + box.height / 2);
    else console.error(`step ${i}: ${s} not found`);
  }
  await sleep(delay);
  await capture(i);
  await sleep(Math.max(0, stepMs - delay));
}
if (inputs.length === 0) { await sleep(scenario.settle_ms ?? 8000); await capture(0); }
const timing = ((await evaluate(() => globalThis.__parityTiming)) ?? []).map((e, k) => ({
  step: k + 1, input: inputs[k], frame_ms: e.frame && +e.frame.toFixed(1),
  relocate_ms: e.relocate && +e.relocate.toFixed(1), relocate_frame_ms: e.relocateFrame && +e.relocateFrame.toFixed(1),
}));
fs.writeFileSync(`${out}/captures.jsonl`, captures.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(`${out}/timing.json`, JSON.stringify(timing, null, 1));
fs.writeFileSync(`${out}/ipc.json`, JSON.stringify(ipc, null, 1));
console.log(`cef: ${captures.length}/${inputs.length + 1} captures -> ${out}`);
await browser.close().catch(() => {});
kill();
process.exit(0);
