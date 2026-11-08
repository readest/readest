"""run_lite.py SCENARIO OUT BINARY: play a parity scenario on Readest Lite (release build).

Writes OUT/captures.jsonl (capture.js per step), OUT/timing.json (per step: handler time and the
latency of the first and last frame) and OUT/step-NNN.pgm (the frame shown when the step was
captured). Runs under a scratch HOME in OUT/home and a private D-Bus session.
"""
import json, os, shutil, subprocess, sys, time

scenario, out, binary = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))
shutil.rmtree(out, ignore_errors=True)
frames_dir, home = f'{out}/frames', f'{out}/home'
os.makedirs(frames_dir); os.makedirs(home)
steps = scenario['steps']
input_steps = [s for s in steps if not s.startswith('wait:')]  # wait: steps are not captured
delay = scenario.get('capture_ms', 2500)
w, h = scenario.get('size', [1200, 800])

# Step 0 is captured at the first input, before its handlers run; step i 'delay' ms after input i.
hooks = """
(() => {
  let n = 0;
  const emit = (i) => console.log('PARITY ' + JSON.stringify(__parityCapture(i)));
  const onInput = () => {
    if (n === 0) emit(0);
    const i = ++n;
    setTimeout(() => emit(i), %d);
  };
  document.addEventListener('keydown', onInput, true);
  document.addEventListener('pointerdown', onInput, true);
  if (%d === 0) setTimeout(() => emit(0), %d);
})();
""" % (delay, len(input_steps), scenario.get('settle_ms', 8000))
init = f'{out}/init.js'
probe = open(scenario['probe']).read() if scenario.get('probe') else ''
open(init, 'w').write(open(f'{here}/capture.js').read() + probe + hooks)

env = {k: v for k, v in os.environ.items() if k != 'DBUS_SESSION_BUS_ADDRESS'
       and (not k.startswith('XDG_') or k in ('XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE'))}
env.update(HOME=home, BLITZ_TAURI_SIZE=f'{w}x{h}', BLITZ_TAURI_SCALE='1', BLITZ_TAURI_OUT=frames_dir,
           BLITZ_TAURI_INIT=init, BLITZ_TAURI_TAPS=';'.join(steps),
           BLITZ_TAURI_TAP_MS=str(scenario.get('step_ms', 3000)))
if scenario.get('fonts'):  # the only fonts installed (run_cef.mjs gives Readest the same)
    env['BLITZ_FONTS'] = scenario['fonts']
args = ['dbus-run-session', '--', binary] + ([scenario['book']] if scenario.get('book') else [])
proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors='replace')
captures, inputs, frames, log = [], [], [], open(f'{out}/stderr.log', 'w')
deadline = time.time() + scenario.get('timeout_s', 90 + 5 * len(steps))
for line in proc.stderr:
    log.write(line)
    if 'PARITY ' in line:
        captures.append(json.loads(line.split('PARITY ', 1)[1]))
        if len(captures) == len(input_steps) + 1: break
    elif line.startswith('{'):
        try: e = json.loads(line)
        except ValueError: continue
        if e.get('label') in ('key', 'tap'): inputs.append(e)
        elif e.get('label') == 'frame': frames.append(e)
    if time.time() > deadline: break
proc.terminate()
try: proc.wait(10)
except subprocess.TimeoutExpired: proc.kill()

with open(f'{out}/captures.jsonl', 'w') as f:
    for c in captures: f.write(json.dumps(c) + '\n')
timing = []
for i in range(len(input_steps) + 1):
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
shutil.rmtree(frames_dir)
print(f'lite: {len(captures)}/{len(input_steps) + 1} captures, {len(frames)} frames -> {out}')
