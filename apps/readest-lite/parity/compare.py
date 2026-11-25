"""compare.py LITE_DIR CEF_DIR REPORT_DIR [TOLERANCE_PX]: compare two parity runs step by step.

A step passes when the book location matches (the visible range's CFI, page and page count),
every element present in both runs has its border box within TOLERANCE_PX (default 2) in x, y,
width and height, with no element present in only one of them, and neither screen has ink (gray
below 128) with none within TOLERANCE_PX in the other, over 25 CSS px² or more in one place: text
that differs, an outline only one app draws. Glyph edges, hinting and anti-aliasing stay within
that distance. Two known differences are not judged: elements inside an <svg> (Blitz paints inline
SVG as one image, so they have no boxes of their own; the <svg> box itself is compared), and where
an element empty in both (0x0) sits. The pixel diff (grayscale, |delta| > 32) is reported, not judged. A Tauri command Lite doesn't have (ipc.json of the runs) fails
the run unless commands-missing.json lists it. Writes REPORT_DIR/report.html, REPORT_DIR/summary.json
and REPORT_DIR/ipc.json.
"""
import html, json, os, re, sys
import numpy as np
from PIL import Image
from scipy.ndimage import find_objects, label, maximum_filter

lite_dir, cef_dir, rep = sys.argv[1:4]
tol = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
os.makedirs(rep, exist_ok=True)
load = lambda d: [json.loads(l) for l in open(f'{d}/captures.jsonl') if l.strip()]
lite, cef = load(lite_dir), load(cef_dir)
timing = {k: {t['step']: t for t in json.load(open(f'{d}/timing.json'))} for k, d in (('lite', lite_dir), ('cef', cef_dir))}

def short(p):
    p = re.sub(r'\[1\]', '', p)
    p = p.replace('/#shadow', ' ⟂').replace('/#doc', ' ▣')
    return p

def gray(path):
    if not os.path.exists(path): return None
    im = Image.open(path)
    if im.mode == 'L': return np.asarray(im, dtype=np.int16)
    a = np.asarray(im.convert('RGB'), dtype=np.int32)
    return ((a[..., 0] * 77 + a[..., 1] * 150 + a[..., 2] * 29) >> 8).astype(np.int16)

def ink_only_in_one(ga, gb, rects):
    """Places where one screen has ink and the other none within `tol` CSS px, of 25 CSS px² or
    more, as [area, [x0, y0, x1, y1], the smallest element around it], in CSS px, largest first.
    `rects` are the elements both runs have (an iframe's own are in its viewport: left out)."""
    s = ga.shape[1] / rects['/html[1]'][2]  # device px per CSS px
    r = max(1, round(tol * s))
    near = lambda m, d: maximum_filter(m, size=2 * d + 1)  # within d device px (a square)
    ia, ib = ga < 128, gb < 128
    lone = (ia & ~near(ib, r)) | (ib & ~near(ia, r))
    groups = label(near(lone, 2 * r))[0]  # one place each
    found = []
    for o in find_objects(np.where(lone, groups, 0)):
        area = lone[o].sum() / s / s if o else 0
        if area < 25: continue
        x0, y0, x1, y1 = o[1].start / s, o[0].start / s, o[1].stop / s, o[0].stop / s
        around = [k for k, (x, y, w, h) in rects.items()
                  if '#doc' not in k and w * h and x <= x0 and y <= y0 and x + w >= x1 and y + h >= y1]
        el = min(around, key=lambda k: rects[k][2] * rects[k][3], default='')
        found.append([round(area), [round(x0), round(y0), round(x1), round(y1)], el])
    return sorted(found, reverse=True)

rows, summary = [], []
for a, b in zip(lite, cef):
    i = a['step']
    la, lb = a['loc'], b['loc']
    loc_ok = la == lb if (la or lb) else True
    in_svg = lambda k: re.search(r'/svg\[\d+\]/', k) is not None
    ka = {k: v for k, v in a['rects'].items() if not in_svg(k)}
    kb = {k: v for k, v in b['rects'].items() if not in_svg(k)}
    skipped = len(a['rects']) - len(ka)
    only_lite = [k for k in ka if k not in kb]
    only_cef = [k for k in kb if k not in ka]
    moved = []
    for k, ra in ka.items():
        rb = kb.get(k)
        if rb is None: continue
        if ra[2:] == [0, 0] and rb[2:] == [0, 0]: continue
        d = max(abs(x - y) for x, y in zip(ra, rb))
        if d > tol: moved.append((k, d, ra, rb))
    ga, gb = gray(f'{lite_dir}/step-{i:03}.pgm'), gray(f'{cef_dir}/step-{i:03}.png')
    pix, ink = None, []
    img = f'step-{i:03}.png'
    if ga is not None and gb is not None:
        hh, ww = min(ga.shape[0], gb.shape[0]), min(ga.shape[1], gb.shape[1])
        ink = ink_only_in_one(ga[:hh, :ww], gb[:hh, :ww], {k: ka[k] for k in ka if k in kb})
        diff = np.abs(ga[:hh, :ww] - gb[:hh, :ww]) > 32
        pix = round(100 * diff.mean(), 2)
        heat = np.stack([gb[:hh, :ww]] * 3, -1).astype(np.uint8) // 2 + 64
        heat[diff] = [230, 40, 40]
        strip = np.concatenate([np.stack([ga[:hh, :ww]] * 3, -1).astype(np.uint8),
                                np.stack([gb[:hh, :ww]] * 3, -1).astype(np.uint8), heat], 1)
        Image.fromarray(strip).save(f'{rep}/{img}')
    ok = loc_ok and not moved and not only_lite and not only_cef and not ink
    ta, tb = timing['lite'].get(i, {}), timing['cef'].get(i, {})
    summary.append(dict(step=i, input=ta.get('input') or tb.get('input'), ok=ok, loc_ok=loc_ok,
                        moved=len(moved), only_lite=len(only_lite), only_cef=len(only_cef),
                        compared=len(set(ka) & set(kb)), svg_skipped=skipped, ink_only_in_one=ink, pixel_diff_pct=pix,
                        lite_first_frame_ms=ta.get('first_frame_ms'), lite_handler_ms=ta.get('handler_ms'),
                        cef_frame_ms=tb.get('relocate_frame_ms') or tb.get('frame_ms')))
    rows.append((i, a, b, ok, loc_ok, moved, only_lite, only_cef, ink, pix, img if pix is not None else None))
json.dump(summary, open(f'{rep}/summary.json', 'w'), indent=1)

# Tauri commands (ipc-log.js): one Lite doesn't have ("not found", "not allowed by ACL") while
# Readest's call of it didn't fail fails the run, unless commands-missing.json lists it. Other
# errors that only Lite hit are reported.
def load_ipc(d):
    return json.load(open(f'{d}/ipc.json')) if os.path.exists(f'{d}/ipc.json') else []
ipc_lite, ipc_cef = load_ipc(lite_dir), load_ipc(cef_dir)
known = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'commands-missing.json')))
listed = lambda c: any(c.startswith(k[:-1]) if k.endswith('*') else c == k for k in known)
cef_failed = {x['cmd'] for x in ipc_cef if not x['ok']}
absent = sorted({x['cmd'] for x in ipc_lite if not x['ok'] and x['cmd'] not in cef_failed
                 and re.search(r'not found|not allowed by ACL', x['error'] or '')})
unlisted = [c for c in absent if not listed(c)]
lite_errors = {}
for x in ipc_lite:
    if not x['ok'] and x['cmd'] not in absent and x['cmd'] not in cef_failed:
        lite_errors.setdefault(x['cmd'], x['error'])
json.dump(dict(lite_calls=len(ipc_lite), readest_calls=len(ipc_cef), not_in_lite=absent, not_listed=unlisted,
               errors_only_in_lite=lite_errors), open(f'{rep}/ipc.json', 'w'), indent=1)

e = html.escape
out = ['<!doctype html><meta charset=utf-8><title>Readest Lite parity</title><style>'
       'body{font:14px system-ui;margin:24px;max-width:1500px}table{border-collapse:collapse}'
       'td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}'
       '.ok{color:#176a2c;font-weight:600}.bad{color:#b3261e;font-weight:600}code{font-size:12px}'
       'img{max-width:100%;border:1px solid #999}details{margin:6px 0}</style>',
       f'<h1>Readest Lite ⟷ Readest desktop parity</h1><p>Lite: <code>{e(lite_dir)}</code><br>Readest: '
       f'<code>{e(cef_dir)}</code><br>Pass: same CFI, page and page count; every element within {tol:g} px; '
       f'no element in only one app; no ink in one app without ink within {tol:g} px in the other '
       '(25 px² or more in one place). Images: Lite | Readest | differing pixels.</p>',
       '<table><tr><th>step</th><th>input</th><th>result</th><th>location</th><th>elements compared</th>'
       '<th>moved &gt; tol</th><th>only Lite</th><th>only Readest</th><th>ink in one</th><th>pixels differ</th>'
       '<th>Lite first frame / handler</th><th>Readest frame</th></tr>']
for s in summary:
    out.append(f"<tr><td><a href='#s{s['step']}'>{s['step']}</a></td><td>{e(str(s['input'] or 'start'))}</td>"
               f"<td class={'ok' if s['ok'] else 'bad'}>{'pass' if s['ok'] else 'FAIL'}</td>"
               f"<td class={'ok' if s['loc_ok'] else 'bad'}>{'same' if s['loc_ok'] else 'differs'}</td>"
               f"<td>{s['compared']}</td><td>{s['moved']}</td><td>{s['only_lite']}</td><td>{s['only_cef']}</td>"
               f"<td>{len(s['ink_only_in_one'])}</td>"
               f"<td>{s['pixel_diff_pct']}%</td><td>{s['lite_first_frame_ms']} / {s['lite_handler_ms']} ms</td>"
               f"<td>{s['cef_frame_ms']} ms</td></tr>")
out.append('</table>')
out.append(f'<h2>Commands: <span class={"bad" if unlisted else "ok"}>{"FAIL" if unlisted else "pass"}</span></h2>'
           f'<p>Lite called {len(ipc_lite)} Tauri commands, Readest {len(ipc_cef)}. A command Lite doesn\'t have '
           'fails the run unless commands-missing.json lists it.</p><ul>'
           + ''.join(f"<li class={'bad' if c in unlisted else ''}><code>{e(c)}</code>{' (not listed)' if c in unlisted else ''}</li>"
                     for c in absent) + '</ul>')
if lite_errors:
    out.append('<details><summary>Errors only Lite hit</summary><ul>'
               + ''.join(f'<li><code>{e(c)}</code>: {e(str(err))}</li>' for c, err in lite_errors.items()) + '</ul></details>')
for i, a, b, ok, loc_ok, moved, only_lite, only_cef, ink, pix, img in rows:
    out.append(f"<h2 id=s{i}>Step {i}: <span class={'ok' if ok else 'bad'}>{'pass' if ok else 'FAIL'}</span></h2>")
    out.append(f"<p>Lite location <code>{e(json.dumps(a['loc']))}</code><br>Readest location <code>{e(json.dumps(b['loc']))}</code></p>")
    if moved:
        out.append(f'<details open><summary>{len(moved)} elements moved more than {tol:g} px (tree order, first 40)</summary>'
                   '<table><tr><th>element</th><th>Δ px</th><th>Lite x,y,w,h</th><th>Readest x,y,w,h</th></tr>')
        for k, d, ra, rb in moved[:40]:
            out.append(f'<tr><td><code>{e(short(k))}</code></td><td>{d:.1f}</td><td>{ra}</td><td>{rb}</td></tr>')
        out.append('</table></details>')
    for name, lst in (('only in Lite', only_lite), ('only in Readest', only_cef)):
        if lst:
            out.append(f'<details><summary>{len(lst)} elements {name} (first 30)</summary><ul>'
                       + ''.join(f'<li><code>{e(short(k))}</code></li>' for k in lst[:30]) + '</ul></details>')
    if ink:
        out.append(f'<details open><summary>{len(ink)} places with ink in one app only</summary>'
                   '<table><tr><th>px²</th><th>x0,y0,x1,y1</th><th>inside</th></tr>'
                   + ''.join(f'<tr><td>{n}</td><td>{box}</td><td><code>{e(short(el))}</code></td></tr>' for n, box, el in ink)
                   + '</table></details>')
    if img: out.append(f"<img src='{img}' loading=lazy>")
open(f'{rep}/report.html', 'w').write('\n'.join(out))
passed = sum(s['ok'] for s in summary)
print(f'{passed}/{len(summary)} steps pass -> {rep}/report.html')
for s in summary:
    if not s['ok']:
        why = [w for w, bad in (('location', not s['loc_ok']), (f"{s['moved']} moved", s['moved']),
                                (f"{s['only_lite'] + s['only_cef']} in one app", s['only_lite'] + s['only_cef'])) if bad]
        why += [f'ink in one app ({n} px² at {box}, in {short(el)[-40:]})' for n, box, el in s['ink_only_in_one']]
        print(f"  step {s['step']} ({s['input'] or 'start'}): {'; '.join(why)}")
print(f'commands: Lite lacks {len(absent)} it was asked for, {len(unlisted)} not in commands-missing.json'
      + ''.join(f'\n  not listed: {c}' for c in unlisted)
      + (f'; {len(lite_errors)} other errors only in Lite' if lite_errors else ''))
sys.exit(1 if unlisted else 0)
