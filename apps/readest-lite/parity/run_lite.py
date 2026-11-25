"""run_lite.py SCENARIO OUT BINARY: play a parity scenario on Readest Lite (release build).

Writes OUT/captures.jsonl (capture.js per step), OUT/timing.json (per step: handler time and the
latency of the first and last frame), OUT/ipc.json (every Tauri command called, and how it ended:
ipc-log.js) and OUT/step-NNN.pgm (the frame shown when the step was captured). Runs under a
scratch HOME in OUT/home and a private D-Bus session. With PARITY_BACKEND (backend.py's DIR) the
app uses that server, signed in; with PARITY_HOME (a previous run's OUT/home) it starts on a copy
of that home, as after a restart.
"""
import json, os, re, shutil, signal, subprocess, sys, threading, time

scenario, out, binary = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))
shutil.rmtree(out, ignore_errors=True)
frames_dir, home = f'{out}/frames', f'{out}/home'
os.makedirs(frames_dir)
if os.environ.get('PARITY_HOME'):
    shutil.copytree(os.environ['PARITY_HOME'], home, symlinks=True)
else:
    os.makedirs(home)
# `text:Label` taps the element showing Label (text-steps.js tags it).
texts = [s[5:] for s in scenario['steps'] if s.startswith('text:')]
steps = [f'[data-parity-text="{s[5:]}"]' if s.startswith('text:') else s for s in scenario['steps']]
input_steps = [s for s in steps if not s.startswith('wait:')]  # wait: steps are not captured
delay = scenario.get('capture_ms', 2500)
w, h = scenario.get('size', [1200, 800])  # CSS px
scale = scenario.get('scale', 1)  # device px per CSS px (the Kindle Voyage: 536x724 at 2)

# Step 0 is captured at the first input, before its handlers run; step i 'delay' ms after input i.
hooks = """
(() => {
  let n = 0, last = -Infinity;
  const emit = (i) => console.log('PARITY ' + JSON.stringify(__parityCapture(i)));
  const onInput = () => {
    // The two taps of a double tap (`2x:`) are one step.
    if (performance.now() - last < 300) return;
    last = performance.now();
    if (n === 0) emit(0);
    const i = ++n;
    setTimeout(() => emit(i), %d);
  };
  // A tap on the book reaches only its section's document: listen in every document the page
  // shows (iframes, also inside shadow roots), each once.
  const hooked = new WeakSet();
  const hook = (doc) => {
    if (hooked.has(doc)) return;
    hooked.add(doc);
    doc.addEventListener('keydown', onInput, true);
    doc.addEventListener('pointerdown', onInput, true);
  };
  const scan = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) scan(el.shadowRoot);
      if (el.localName !== 'iframe') continue;
      let doc = null;
      try { doc = el.contentDocument; } catch {}
      if (doc?.documentElement) { hook(doc); scan(doc); }
    }
  };
  hook(document);
  setInterval(() => scan(document), 300);
  if (%d === 0) setTimeout(() => emit(0), %d);
})();
""" % (delay, len(input_steps), scenario.get('settle_ms', 8000))
init = f'{out}/init.js'
probe = open(scenario['probe']).read() if scenario.get('probe') else ''
backend = os.environ.get('PARITY_BACKEND')
backend_js = subprocess.run([sys.executable, f'{here}/backend.py', 'init', backend, 'lite'], check=True,
                            capture_output=True, text=True).stdout if backend else ''
open(init, 'w').write(backend_js + open(f'{here}/ipc-log.js').read() + open(f'{here}/capture.js').read()
                     + open(f'{here}/text-steps.js').read() + probe + hooks
                     + f'\n__parityTexts({json.dumps(texts)});\n')

env = {k: v for k, v in os.environ.items() if k != 'DBUS_SESSION_BUS_ADDRESS'
       and (not k.startswith('XDG_') or k in ('XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE'))}
env.update(HOME=home, BLITZ_TAURI_SIZE=f'{w * scale}x{h * scale}', BLITZ_TAURI_SCALE=str(scale), BLITZ_TAURI_OUT=frames_dir,
           BLITZ_TAURI_INIT=init, BLITZ_TAURI_TAPS=';'.join(steps),
           BLITZ_TAURI_TAP_MS=str(scenario.get('step_ms', 3000)))
if scenario.get('eink'):  # Readest's e-ink mode, as the Kindle launcher starts it
    env['READEST_LITE_EINK'] = '1'
if scenario.get('settings'):  # saved settings the app starts with (Readest fills in the rest)
    os.makedirs(f'{home}/.config/com.bilingify.readest-lite', exist_ok=True)
    json.dump(scenario['settings'], open(f'{home}/.config/com.bilingify.readest-lite/settings.json', 'w'))
if scenario.get('fonts'):  # the only fonts installed (run_cef.mjs gives Readest the same)
    env['BLITZ_FONTS'] = scenario['fonts']
args = ['dbus-run-session', '--', binary] + ([scenario['book']] if scenario.get('book') else [])
# Its own process group, ended however this script ends: the app outlives a signal to
# dbus-run-session alone, and a silent app would hold the loop below past the deadline.
proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors='replace',
                        start_new_session=True)
def stop(sig=signal.SIGTERM):
    try: os.killpg(proc.pid, sig)
    except ProcessLookupError: pass
signal.signal(signal.SIGTERM, lambda *_: (stop(), sys.exit(1)))
signal.signal(signal.SIGINT, lambda *_: (stop(), sys.exit(1)))
watchdog = threading.Timer(scenario.get('timeout_s', 90 + 5 * len(steps)), stop)
watchdog.start()
captures, inputs, frames, ipc, log = [], [], [], [], open(f'{out}/stderr.log', 'w')
try:
    for line in proc.stderr:
        log.write(line)
        if 'PARITY-IPC ' in line:  # ipc-log.js: a command the page called, and how it ended
            ipc.append(json.loads(line.split('PARITY-IPC ', 1)[1]))
        elif 'PARITY ' in line:
            captures.append(json.loads(line.split('PARITY ', 1)[1]))
            if len(captures) == len(input_steps) + 1: break
        elif line.startswith('{'):
            try: e = json.loads(line)
            except ValueError:  # a tap line's target is not escaped: a selector's quotes break it
                m = re.match(r'\{"label": "(tap|key)", "t_ms": ([\d.]+), .*"handler_ms": ([\d.]+)', line)
                if not m: continue
                e = dict(label=m[1], t_ms=float(m[2]), handler_ms=float(m[3]))
            if e.get('label') in ('key', 'tap'): inputs.append(e)
            elif e.get('label') == 'frame': frames.append(e)
finally:
    watchdog.cancel()
    stop()
    try: proc.wait(10)
    except subprocess.TimeoutExpired: stop(signal.SIGKILL)
    log.close()

with open(f'{out}/captures.jsonl', 'w') as f:
    for c in captures: f.write(json.dumps(c) + '\n')
timing = []
for i in range(len(input_steps) + 1):
    if i > len(inputs): break  # an input not sent (a selector not found stops the taps)
    start = inputs[i - 1]['t_ms'] if i else 0.0
    end = inputs[i]['t_ms'] if i < len(inputs) else float('inf')
    seg = [fr for fr in frames if start <= fr['t_ms'] < end]
    if seg:  # the frame on screen when the step settled
        shutil.copy(f"{frames_dir}/main-{seg[-1]['n']:03}.pgm", f'{out}/step-{i:03}.pgm')
    if i:
        e = inputs[i - 1] if i - 1 < len(inputs) else {}
        timing.append(dict(step=i, input=input_steps[i - 1], handler_ms=e.get('handler_ms'),
                           first_frame_ms=round(seg[0]['t_ms'] - start, 1) if seg else None,
                           last_frame_ms=round(seg[-1]['t_ms'] - start, 1) if seg else None,
                           frames=len(seg), layout_ms=sum(f['layout_ms'] for f in seg),
                           paint_ms=round(sum(f['paint_ms'] for f in seg), 1)))
json.dump(timing, open(f'{out}/timing.json', 'w'), indent=1)
json.dump(ipc, open(f'{out}/ipc.json', 'w'), indent=1)
if not os.environ.get('PARITY_KEEP_FRAMES'):  # every frame, to see what each turn showed
    shutil.rmtree(frames_dir, ignore_errors=True)  # the app may still be writing one
print(f'lite: {len(captures)}/{len(input_steps) + 1} captures, {len(frames)} frames -> {out}')
