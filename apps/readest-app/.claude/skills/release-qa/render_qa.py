#!/usr/bin/env python3
"""Render a release-QA results log into one HTML page for the Artifact tool.

Usage:
  render_qa.py --results results.md --config qa.json --images DIR [--images DIR ...] --out OUTDIR

Writes OUTDIR/index.html and OUTDIR/shots/*.webp (downscaled evidence). Publish
with the Artifact tool: file_path OUTDIR/index.html, files {"shots/<name>": <path>},
capabilities {"db": {}} (the manual checklist keeps its ticks in the page's db,
collection "checklist", one document per item id: {done: bool, note: str}).

Results log, one check per line (anything else is ignored):
  [STATUS] Platform | #PR #PR | what was done -> what was seen
STATUS is PASS, PASS?, FAIL, ISSUE, NOTE, MANUAL, NOT RUN, SKIP (others render
as "other"). The platform or PR field may be left out. Put "Cause: ..." in a
FAIL/ISSUE line to show the cause on its own line. Image file names in the text
(a-shot.png, shots/x.png) attach as evidence when found in an --images dir.
A line "## <heading>" starts a section; rows under a heading that contains
"premium" fill the Premium section.

Fixes that land after the run go in a section headed "## Fixed in #<PR> (<details>)":
  [FIXED] #PR | short name (line 86): what the fix does and how it was checked
  [OPEN] not fixed: a list naming each line still open, e.g. (line 34) (29, 48)
"(line N)" / "(lines N, M)" are line numbers of the original lines in the results
file. The original line stays as written; the page adds the fix beside it (a
"Unit tests only" tag when the text says it was covered by unit tests and not
reproduced) or a "Still open" tag. FIXED/OPEN lines are not counted as checks.

Config (JSON): title, heading, from, to, sha, date, rangeNote, repo,
environments [{platform, detail}], evidence [{contains, status?, shots[], caption?}],
premium {planned [{text, prs[]}], note}, checklist [{title, note?, items [{id, text, prs[]}]}].
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

from PIL import Image

STATUS_ORDER = ['FAIL', 'ISSUE', 'PASS', 'PASS?', 'NOTE', 'MANUAL', 'NOT RUN', 'SKIP', 'OTHER']
STATUS_SLUG = {
    'FAIL': 'fail', 'ISSUE': 'issue', 'PASS': 'pass', 'PASS?': 'partial', 'NOTE': 'note',
    'MANUAL': 'manual', 'NOT RUN': 'notrun', 'SKIP': 'notrun', 'OTHER': 'other',
}
STATUS_LABEL = {
    'FAIL': 'Fail', 'ISSUE': 'Issue', 'PASS': 'Pass', 'PASS?': 'Partly', 'NOTE': 'Note',
    'MANUAL': 'Manual', 'NOT RUN': 'Not run', 'SKIP': 'Skipped', 'OTHER': 'Other',
}
LINE_RE = re.compile(r'^\[([A-Z][A-Z? ]*?)\]\s*(.*)$')
IMG_RE = re.compile(r'[\w.\-]+\.(?:png|jpe?g|webp)', re.I)


def esc(s):
    return html.escape(str(s), quote=True)


FIX_HEAD_RE = re.compile(r'fixed in #(\d+)\s*(?:\((.*)\))?', re.I)
LINE_REF_RE = re.compile(r'\(lines? ([\d,\s]+)\):?\s*')


def parse(results_path):
    rows, fixes, opens, section, fix_pr, fix_detail = [], [], [], '', '', ''
    for lineno, raw in enumerate(Path(results_path).read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if line.startswith('## '):
            section = line[3:].strip()
            fm = FIX_HEAD_RE.search(section)
            fix_pr, fix_detail = (fm.group(1), fm.group(2) or '') if fm else ('', '')
            continue
        fixed_or_open = re.match(r'^\[(FIXED|OPEN)\]\s*(.*)$', line)
        if fixed_or_open and fix_pr:
            kind, body = fixed_or_open.groups()
            if kind == 'FIXED':
                ref = LINE_REF_RE.search(body)
                refs = [int(n) for n in re.findall(r'\d+', ref.group(1))] if ref else []
                text = body[ref.end():] if ref else body
                fixes.append({'pr': fix_pr, 'detail': fix_detail, 'refs': refs, 'text': text,
                              'unit_only': bool(re.search(r'unit tests', body, re.I) and re.search(r'not reproduced', body, re.I))})
            else:
                refs = [int(n) for g in re.findall(r'\(([^)]*)\)', body) for n in re.findall(r'\b(\d{1,4})\b', g)]
                opens.append({'pr': fix_pr, 'refs': refs})
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        status, rest = m.group(1).strip(), m.group(2)
        parts = [p.strip() for p in rest.split(' | ')]
        platform, prfield, text = '', '', rest
        if len(parts) >= 3:
            platform, prfield, text = parts[0], parts[1], ' | '.join(parts[2:])
        elif len(parts) == 2:
            if parts[0].startswith('#'):
                prfield, text = parts
            else:
                platform, text = parts
        prs = re.findall(r'#(\d{3,6})', prfield)
        tag = '' if prs or prfield in ('', '-') else prfield
        group = status if status in STATUS_SLUG else 'OTHER'
        rows.append({
            'status': status, 'group': group, 'platform': platform, 'prs': prs, 'tag': tag,
            'text': text, 'section': section, 'premium': 'premium' in section.lower(), 'shots': [],
            'lineno': lineno, 'fixed': None, 'open': '',
        })
    by_line = {r['lineno']: r for r in rows}
    for fx in fixes:
        for n in fx['refs']:
            if n in by_line:
                by_line[n]['fixed'] = fx
            else:
                print(f'warning: FIXED line refers to line {n}, which is not a check', file=sys.stderr)
    for op in opens:
        for n in op['refs']:
            if n in by_line:
                by_line[n]['open'] = op['pr']
            else:
                print(f'warning: OPEN line refers to line {n}, which is not a check', file=sys.stderr)
    return rows


def find_image(name, dirs):
    for d in dirs:
        p = Path(d) / name
        if p.is_file():
            return p
    return None


def convert(src, out_dir, done):
    if src in done:
        return done[src]
    name = src.stem + '.webp'
    n = 2
    while name in done.values():
        name = f'{src.stem}-{n}.webp'
        n += 1
    im = Image.open(src)
    im = im.convert('RGB')
    w, h = im.size
    max_w = 1400 if w / max(h, 1) > 2.2 else 900
    if w > max_w:
        im = im.resize((max_w, round(h * max_w / w)), Image.LANCZOS)
    im.save(out_dir / name, 'WEBP', quality=78, method=6)
    done[src] = name
    return name


def attach_evidence(rows, cfg, dirs, shots_dir):
    done, missing = {}, []

    def add(row, fname, caption=''):
        src = find_image(Path(fname).name, dirs)
        if not src:
            missing.append(fname)
            return
        out = convert(src, shots_dir, done)
        if out not in [s['src'] for s in row['shots']]:
            row['shots'].append({'src': f'shots/{out}', 'caption': caption})

    for row in rows:
        for fname in IMG_RE.findall(row['text']):
            add(row, fname)
    for ev in cfg.get('evidence', []):
        hit = False
        for row in rows:
            if ev['contains'] in row['text'] and ev.get('status', row['status']) == row['status']:
                for f in ev['shots']:
                    add(row, f, ev.get('caption', ''))
                hit = True
        if not hit:
            print(f"warning: evidence matched no line: {ev['contains']!r}", file=sys.stderr)
    for f in sorted(set(missing)):
        print(f'warning: image not found: {f}', file=sys.stderr)


def rich(text, repo):
    s = esc(text)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'(?<![\w/&])#(\d{4,5})\b',
               lambda m: f'<a href="https://github.com/{repo}/pull/{m.group(1)}" target="_blank" rel="noopener">#{m.group(1)}</a>', s)
    s = s.replace(' -&gt; ', ' → ').replace('-&gt;', '→')
    return s


def pr_links(prs, repo):
    return ' '.join(
        f'<a class="pr" href="https://github.com/{repo}/pull/{p}" target="_blank" rel="noopener">#{p}</a>' for p in prs)


def pill(row):
    return f'<span class="pill s-{STATUS_SLUG[row["group"]]}">{esc(STATUS_LABEL.get(row["status"], row["status"].title()))}</span>'


def shots_button(row, label=None):
    if not row['shots']:
        return ''
    data = esc(json.dumps(row['shots']))
    n = len(row['shots'])
    text = label or (f'{n} screenshots' if n > 1 else 'Screenshot')
    return f'<button type="button" class="ev" data-shots="{data}">{text}</button>'


def split_cause(text):
    m = re.search(r'\bCause:\s*', text)
    if not m:
        return text, ''
    return text[:m.start()].rstrip(' .'), text[m.end():]


def fix_link(fx, repo, label):
    return f'<a class="pill s-fixed" href="https://github.com/{repo}/pull/{fx["pr"]}" target="_blank" rel="noopener">{label}</a>'


def resolution(row, repo):
    fx = row['fixed']
    if fx:
        unit = '<span class="tag">Unit tests only</span>' if fx['unit_only'] else ''
        return (f'<div class="res"><span class="k">Fixed in <a href="https://github.com/{repo}/pull/{fx["pr"]}" '
                f'target="_blank" rel="noopener">#{fx["pr"]}</a></span>{unit}<p>{rich(fx["text"], repo)}</p></div>')
    if row['open']:
        return '<div class="res-open"><span class="tag open">Still open</span></div>'
    return ''


def render_problem(row, repo):
    main, cause = split_cause(row['text'])
    figs = ''.join(
        f'<button type="button" class="thumb" data-shots="{esc(json.dumps(row["shots"][i:] + row["shots"][:i]))}">'
        f'<img src="{esc(s["src"])}" alt="{esc(s["caption"] or "Evidence for " + " ".join("#" + p for p in row["prs"]))}" loading="lazy"></button>'
        for i, s in enumerate(row['shots']))
    cause_html = f'<p class="cause"><span class="k">Cause</span>{rich(cause, repo)}</p>' if cause else ''
    return f'''<article class="problem">
  <header>{pill(row)}<span class="plat">{esc(row["platform"] or "—")}</span>{pr_links(row["prs"], repo)}{fix_link(row["fixed"], repo, "Fixed in #" + row["fixed"]["pr"]) if row["fixed"] else ""}</header>
  <div class="pbody"><div class="ptext"><p>{rich(main, repo)}</p>{cause_html}{resolution(row, repo)}</div>{f'<div class="figs">{figs}</div>' if figs else ''}</div>
</article>'''


def render_row(row, i, repo):
    plat = row['platform'] or '—'
    pkey = plat.lower() if row['platform'] else 'other'
    search = ' '.join([row['status'], plat, row['tag'], ' '.join('#' + p for p in row['prs']), row['text']]).lower()
    prs = pr_links(row['prs'], repo) or (f'<span class="tag">{esc(row["tag"])}</span>' if row['tag'] else '<span class="dim">—</span>')
    sect = '<span class="tag signed">Signed in</span>' if row['premium'] else ''
    fixed = fix_link(row['fixed'], repo, 'Fixed') if row['fixed'] else ''
    return f'''<div class="row" id="r{i}" data-group="{STATUS_SLUG[row["group"]]}" data-fixed="{1 if row["fixed"] else 0}" data-platform="{esc(pkey)}" data-search="{esc(search)}">
  <div class="c-status">{pill(row)}{fixed}</div><div class="c-plat">{esc(plat)}</div><div class="c-prs">{prs}{sect}</div>
  <div class="c-text"><p>{rich(row["text"], repo)}</p>{resolution(row, repo)}{shots_button(row)}</div>
</div>'''


def render(rows, cfg):
    repo = cfg.get('repo', 'readest/readest')
    counts = {k: 0 for k in STATUS_ORDER}
    for r in rows:
        counts[r['group']] += 1
    total = len(rows)

    bar = ''.join(
        f'<span class="seg s-{STATUS_SLUG[k]}" style="flex-grow:{counts[k]}" title="{esc(STATUS_LABEL[k])}: {counts[k]}"></span>'
        for k in STATUS_ORDER if counts[k])
    tiles = ''.join(
        f'<button type="button" class="count s-{STATUS_SLUG[k]}" data-jump="{STATUS_SLUG[k]}"><span class="n">{counts[k]}</span><span class="l">{esc(STATUS_LABEL[k])}</span></button>'
        for k in STATUS_ORDER if counts[k])

    envs = ''.join(
        f'<div class="env"><h3>{esc(e["platform"])}</h3><p>{rich(e["detail"], repo)}</p></div>'
        for e in cfg.get('environments', []))

    problems = [r for r in rows if r['group'] in ('FAIL', 'ISSUE')]
    problems.sort(key=lambda r: STATUS_ORDER.index(r['group']))
    problems_html = '\n'.join(render_problem(r, repo) for r in problems) or '<p class="empty">No failures or issues recorded.</p>'

    fixed_rows = [r for r in rows if r['fixed']]
    fix_prs = {}
    for r in fixed_rows:
        fix_prs.setdefault(r['fixed']['pr'], (r['fixed']['detail'], []))[1].append(r)
    update_html = ''
    for pr, (detail, frs) in fix_prs.items():
        kinds = [(sum(1 for r in frs if r['group'] == g), one, many) for g, one, many in
                 (('FAIL', 'failure', 'failures'), ('ISSUE', 'issue', 'issues'), ('NOTE', 'note', 'notes'))]
        parts = [f'{n} {one if n == 1 else many}' for n, one, many in kinds if n]
        what = ', '.join(parts[:-1]) + (' and ' if len(parts) > 1 else '') + parts[-1] if parts else f'{len(frs)} findings'
        update_html += (f'<p><a class="pill s-fixed" href="https://github.com/{repo}/pull/{pr}" target="_blank" rel="noopener">Update</a> '
                        f'<a href="https://github.com/{repo}/pull/{pr}" target="_blank" rel="noopener">#{pr}</a> '
                        f'{"(" + esc(detail) + ") " if detail else ""}fixes {what} from this run. Each keeps the original observation with the fix beside it; findings tagged Still open are not fixed.</p>')
    if update_html:
        update_html = f'<div class="update">{update_html}</div>'
    nfixed_prob = sum(1 for r in problems if r['fixed'])
    prob_sub = 'Failures and issues, with the cause read in the code' + (
        f' · {nfixed_prob} of {len(problems)} fixed since' if nfixed_prob else '')

    notes = [r for r in rows if r['group'] == 'NOTE']
    nfixed_notes = sum(1 for r in notes if r['fixed'])
    notes_sub = 'Worth a look; not counted as failures' + (f' · {nfixed_notes} fixed since' if nfixed_notes else '')

    def note_ref(r):
        if r['prs']:
            return f'<span class="c-prs">{pr_links(r["prs"], repo)}</span>'
        return f'<span class="tag">{esc(r["tag"])}</span>' if r['tag'] else '<span></span>'

    notes_html = '\n'.join(
        f'<li><span class="plat">{esc(r["platform"] or "—")}</span>{note_ref(r)}'
        f'<div class="ntext"><p>{rich(r["text"], repo)}</p>{resolution(r, repo)}{shots_button(r)}</div></li>' for r in notes)

    prem_rows = [r for r in rows if r['premium']]
    prem = cfg.get('premium', {})
    if prem_rows:
        prem_html = '<div class="rows">' + '\n'.join(render_row(r, f'p{i}', repo) for i, r in enumerate(prem_rows)) + '</div>'
        prem_state = f'{len(prem_rows)} checks recorded'
    else:
        planned = ''.join(f'<li>{rich(p["text"], repo)} {pr_links(p.get("prs", []), repo)}</li>' for p in prem.get('planned', []))
        prem_html = f'<div class="pending"><p>{rich(prem.get("note", "Testing in progress."), repo)}</p><ul>{planned}</ul></div>'
        prem_state = 'In progress'

    platforms = sorted({(r['platform'] or 'Other') for r in rows}, key=lambda p: (p == 'Other', p))
    plat_buttons = '<button type="button" class="seg-btn" aria-pressed="true" data-plat="all">All</button>' + ''.join(
        f'<button type="button" class="seg-btn" aria-pressed="false" data-plat="{esc(p.lower())}">{esc(p)}</button>' for p in platforms)
    status_chips = '<button type="button" class="chip" aria-pressed="true" data-g="all">All <span>{}</span></button>'.format(total) + ''.join(
        f'<button type="button" class="chip s-{STATUS_SLUG[k]}" aria-pressed="false" data-g="{STATUS_SLUG[k]}">{esc(STATUS_LABEL[k])} <span>{counts[k]}</span></button>'
        for k in STATUS_ORDER if counts[k])
    if fixed_rows:
        status_chips += f'<button type="button" class="chip s-fixed" aria-pressed="false" data-g="fixed">Fixed since <span>{len(fixed_rows)}</span></button>'
    rows_html = '\n'.join(render_row(r, i, repo) for i, r in enumerate(rows))

    ck_total = 0
    groups = []
    for g in cfg.get('checklist', []):
        items = []
        for it in g['items']:
            ck_total += 1
            iid = esc(it['id'])
            items.append(f'''<li class="ck" data-id="{iid}">
  <input type="checkbox" id="ck-{iid}" disabled>
  <label for="ck-{iid}">{rich(it["text"], repo)} {pr_links(it.get("prs", []), repo)}</label>
  <input type="text" class="note" id="note-{iid}" maxlength="300" placeholder="Note" aria-label="Note for {esc(it["text"])}" disabled>
</li>''')
        gnote = f'<p class="gnote">{rich(g["note"], repo)}</p>' if g.get('note') else ''
        groups.append(f'<section class="ckgroup"><h3>{esc(g["title"])}</h3>{gnote}<ul>{"".join(items)}</ul></section>')

    repl = {
        '__TITLE__': esc(cfg['title']),
        '__HEADING__': esc(cfg.get('heading', cfg['title'])),
        '__FROM__': esc(cfg['from']), '__TO__': esc(cfg['to']), '__SHA__': esc(cfg.get('sha', '')),
        '__DATE__': esc(cfg['date']), '__RANGENOTE__': rich(cfg.get('rangeNote', ''), repo),
        '__REPO__': esc(repo),
        '__ENVS__': envs, '__BAR__': bar, '__TILES__': tiles, '__TOTAL__': str(total),
        '__NPROB__': str(len(problems)), '__PROBLEMS__': problems_html, '__PROBSUB__': esc(prob_sub),
        '__NOTES__': notes_html or '<li class="empty">No notes.</li>', '__NNOTES__': str(len(notes)),
        '__NOTESSUB__': esc(notes_sub), '__UPDATE__': update_html,
        '__PREMSTATE__': esc(prem_state), '__PREMIUM__': prem_html,
        '__PLATS__': plat_buttons, '__CHIPS__': status_chips, '__ROWS__': rows_html,
        '__CKTOTAL__': str(ck_total), '__CHECKLIST__': '\n'.join(groups),
    }
    out = TEMPLATE
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


TEMPLATE = r'''<title>__TITLE__</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
/* Layout: a test-lab ledger. Summary strip, then failures as evidence cards, then the full log, then the sign-off list. */
:root {
  --bg: #f4f6f9; --surface: #ffffff; --sunk: #eceff4; --fg: #172030; --muted: #586377; --line: #d9dee7;
  --accent: #2557c7; --accent-ink: #ffffff;
  --s-pass: #1d7a4b; --s-partial: #2f7b86; --s-fail: #c22f2f; --s-issue: #b25e08; --s-note: #4b5b7c;
  --s-manual: #6a45b5; --s-notrun: #6b7280; --s-other: #8a8f99;
  --f-display: "Space Grotesk", "Segoe UI", system-ui, sans-serif;
  --f-body: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --r: 10px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #11151c; --surface: #181e27; --sunk: #1f2631; --fg: #e5e9f0; --muted: #9aa4b5; --line: #2b3340;
  --accent: #7ea3ff; --accent-ink: #0d1422;
  --s-pass: #5ccf93; --s-partial: #6cc6d1; --s-fail: #ff7d7d; --s-issue: #f2a64d; --s-note: #a3b3d6;
  --s-manual: #b89dff; --s-notrun: #a2a9b6; --s-other: #8f96a3; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #11151c; --surface: #181e27; --sunk: #1f2631; --fg: #e5e9f0; --muted: #9aa4b5; --line: #2b3340;
  --accent: #7ea3ff; --accent-ink: #0d1422;
  --s-pass: #5ccf93; --s-partial: #6cc6d1; --s-fail: #ff7d7d; --s-issue: #f2a64d; --s-note: #a3b3d6;
  --s-manual: #b89dff; --s-notrun: #a2a9b6; --s-other: #8f96a3; color-scheme: dark }
* { box-sizing: border-box }
/* The filters and the lightbox hide with the hidden attribute; rules that set display would show them. */
[hidden] { display: none !important }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--f-body); }
.wrap { max-width: 1080px; margin: 0 auto; padding-block: 28px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: grid; gap: 40px; }
a { color: var(--accent) } a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
code, .mono, .pr, .sha { font-family: var(--f-mono); font-size: .88em }
code { background: var(--sunk); padding: 1px 5px; border-radius: 4px }
h1, h2, h3 { font-family: var(--f-display); text-wrap: balance; margin: 0; letter-spacing: -.01em }
h2 { font-size: 1.45rem } h3 { font-size: 1.02rem }
p { margin: 0 }
.eyebrow { font: 600 .74rem/1 var(--f-body); letter-spacing: .12em; text-transform: uppercase; color: var(--muted) }
.s-pass { --s: var(--s-pass) } .s-partial { --s: var(--s-partial) } .s-fail { --s: var(--s-fail) } .s-issue { --s: var(--s-issue) }
.s-note { --s: var(--s-note) } .s-manual { --s: var(--s-manual) } .s-notrun { --s: var(--s-notrun) } .s-other { --s: var(--s-other) }
.pill { display: inline-flex; align-items: center; font: 600 .72rem/1 var(--f-body); letter-spacing: .06em; text-transform: uppercase;
  color: var(--s); background: color-mix(in srgb, var(--s) 13%, transparent); border: 1px solid color-mix(in srgb, var(--s) 35%, transparent);
  padding: 4px 8px; border-radius: 999px; white-space: nowrap }
.plat { font-weight: 600; font-size: .85rem }
.tag { display: inline-block; font-size: .75rem; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px }
.tag.signed { color: var(--s-manual); border-color: color-mix(in srgb, var(--s-manual) 40%, transparent) }
.s-fixed { --s: var(--s-pass) }
a.pill.s-fixed { background: var(--s-pass); color: var(--surface); border-color: var(--s-pass); text-decoration: none }
a.pill.s-fixed:hover { filter: brightness(1.08) }
.res { display: grid; gap: 3px; max-width: 80ch; font-size: .92rem; padding: 8px 12px; border-radius: 8px;
  background: color-mix(in srgb, var(--s-pass) 9%, var(--surface)); border: 1px solid color-mix(in srgb, var(--s-pass) 32%, transparent) }
.res .k { font: 600 .7rem/1.4 var(--f-body); letter-spacing: .1em; text-transform: uppercase; color: var(--s-pass) }
.res .k a { color: inherit }
.res .tag { justify-self: start }
.tag.open { color: var(--s-issue); border-color: color-mix(in srgb, var(--s-issue) 45%, transparent); font-weight: 600 }
.update { display: grid; gap: 8px; padding: 12px 16px; border-radius: var(--r); background: color-mix(in srgb, var(--s-pass) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--s-pass) 30%, transparent); font-size: .93rem }
.update .pill { margin-right: 4px; vertical-align: 1px }
.c-status { display: flex; flex-direction: column; align-items: flex-start; gap: 4px }
.dim { color: var(--muted) }

/* header */
.head { display: grid; gap: 14px }
.head h1 { font-size: clamp(1.9rem, 5vw, 2.8rem); line-height: 1.08 }
.head h1 .arrow { color: var(--muted); font-weight: 500 }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: .9rem }
.meta b { color: var(--fg); font-weight: 600 }
.envs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 6px }
.env { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 16px; display: grid; gap: 4px; min-width: 0 }
.env p { color: var(--muted); font-size: .9rem }
nav.jump { display: flex; flex-wrap: wrap; gap: 8px }
nav.jump a { text-decoration: none; font-size: .85rem; font-weight: 500; color: var(--fg); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; background: var(--surface) }
nav.jump a:hover { border-color: var(--accent) }

/* summary */
.summary { display: grid; gap: 14px }
.bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; gap: 2px; background: var(--sunk) }
.bar .seg { background: var(--s); min-width: 4px; flex-basis: 0 }
.counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 10px }
.count { all: unset; cursor: pointer; display: grid; gap: 2px; padding: 10px 14px; border-radius: var(--r);
  background: var(--surface); border: 1px solid var(--line); font-variant-numeric: tabular-nums }
.count:hover { border-color: var(--s) } .count:focus-visible { outline: 2px solid var(--accent) }
.count .n { font: 600 1.6rem/1.1 var(--f-display); color: var(--s) }
.count .l { font-size: .8rem; color: var(--muted) }

section > .shead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 14px }
.shead .sub { color: var(--muted); font-size: .9rem }

/* problems */
.problems { display: grid; gap: 14px }
.problem { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 16px; display: grid; gap: 12px; min-width: 0 }
.problem > header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center }
.pbody { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start }
.ptext { display: grid; gap: 10px; min-width: 0; max-width: 68ch }
.cause { color: var(--fg); background: var(--sunk); border-radius: 8px; padding: 10px 12px; font-size: .93rem }
.cause .k { display: block; font: 600 .7rem/1.4 var(--f-body); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px }
.figs { display: flex; gap: 8px; flex-wrap: wrap; max-width: 320px }
.thumb { all: unset; cursor: zoom-in; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--sunk); line-height: 0 }
.thumb:focus-visible { outline: 2px solid var(--accent) }
.thumb img { display: block; max-width: 100%; max-height: 240px; width: auto }
@media (max-width: 720px) { .pbody { grid-template-columns: 1fr } .figs { max-width: 100% } }

/* notes */
.notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r) }
.notes li { display: grid; grid-template-columns: 80px 120px minmax(0, 1fr); gap: 4px 14px; padding: 12px 16px; border-top: 1px solid var(--line); align-items: start }
.notes li:first-child { border-top: 0 }
.notes li > .tag, .notes li > .c-prs { justify-self: start }
.notes li .ntext { grid-column: 3; display: grid; gap: 6px; min-width: 0 }
.notes li .ntext p { max-width: 75ch; overflow-wrap: anywhere }
@media (max-width: 640px) { .notes li { grid-template-columns: auto 1fr } .notes li .ntext { grid-column: 1 / -1 } }

/* premium */
.pending { background: var(--surface); border: 1px dashed color-mix(in srgb, var(--s-manual) 45%, var(--line)); border-radius: var(--r); padding: 16px; display: grid; gap: 10px }
.pending ul { margin: 0; padding-left: 20px; display: grid; gap: 4px }

/* results ledger */
.filters { display: grid; gap: 10px; margin-bottom: 12px }
.chips, .segs { display: flex; flex-wrap: wrap; gap: 6px }
.chip, .seg-btn { all: unset; cursor: pointer; font-size: .82rem; font-weight: 500; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--fg) }
.chip span { color: var(--muted); font-variant-numeric: tabular-nums; margin-left: 2px }
.chip[aria-pressed="true"] { border-color: var(--s, var(--accent)); background: color-mix(in srgb, var(--s, var(--accent)) 14%, var(--surface)) }
.seg-btn[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg) }
.chip:focus-visible, .seg-btn:focus-visible { outline: 2px solid var(--accent) }
.frow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center }
.search { flex: 1 1 220px; min-width: 0; font: inherit; font-size: .9rem; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--fg) }
.shown { color: var(--muted); font-size: .85rem; font-variant-numeric: tabular-nums }
.rows { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden }
.row { display: grid; grid-template-columns: 96px 76px 150px minmax(0, 1fr); gap: 12px; padding: 11px 16px; border-top: 1px solid var(--line); align-items: start }
.rows .row:first-child, .rows .row.first { border-top: 0 }
.c-prs { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-width: 0 }
.c-text { display: grid; gap: 6px; min-width: 0 } .c-text p { max-width: 80ch; overflow-wrap: anywhere }
.row:target { background: color-mix(in srgb, var(--accent) 9%, var(--surface)) }
@media (max-width: 680px) {
  .row { grid-template-columns: auto auto minmax(0, 1fr); gap: 6px 10px }
  .c-text { grid-column: 1 / -1 }
}
.ev { all: unset; cursor: zoom-in; justify-self: start; font-size: .8rem; font-weight: 500; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: 6px; padding: 2px 8px }
.ev:focus-visible { outline: 2px solid var(--accent) }
.empty { color: var(--muted) }

/* checklist */
.ckstatus { font-size: .88rem; color: var(--muted) }
.ckgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px }
@media (max-width: 400px) { .ckgrid { grid-template-columns: 1fr } }
.ckgroup { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 16px; display: grid; gap: 8px; align-content: start; min-width: 0 }
.ckgroup ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px }
.gnote { color: var(--muted); font-size: .85rem }
.ck { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 4px 10px; padding: 8px 0; border-top: 1px solid var(--line) }
.ck:first-child { border-top: 0 }
.ck input[type=checkbox] { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--s-pass) }
.ck label { font-size: .93rem; cursor: pointer }
.ck.done label { color: var(--muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent) }
.ck .note { grid-column: 2; font: inherit; font-size: .85rem; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); min-width: 0 }
.ck .note:disabled, .ck input:disabled + label { cursor: default }
.progress { font: 600 1rem var(--f-display); font-variant-numeric: tabular-nums }

footer.foot { color: var(--muted); font-size: .85rem; border-top: 1px solid var(--line); padding-top: 16px }

/* lightbox */
dialog#lb { border: 0; padding: 0; background: var(--surface); color: var(--fg); border-radius: 12px; max-width: min(96vw, 1400px); max-height: 94vh; width: max-content }
dialog#lb::backdrop { background: rgba(8, 12, 20, .72) }
.lb-inner { display: grid; gap: 8px; padding: 12px; max-height: 94vh }
.lb-bar { display: flex; gap: 8px; align-items: center; justify-content: space-between }
.lb-bar .cap { font-size: .88rem; color: var(--muted) }
.lb-bar button { all: unset; cursor: pointer; font-size: .85rem; font-weight: 500; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px }
.lb-bar button:focus-visible { outline: 2px solid var(--accent) }
#lb img { max-width: 100%; max-height: calc(94vh - 70px); object-fit: contain; display: block; margin: 0 auto }
@media (prefers-reduced-motion: no-preference) { .chip, .seg-btn, .count, nav.jump a { transition: border-color .15s, background-color .15s } }
</style>

<div class="wrap">
  <header class="head">
    <span class="eyebrow">Readest release QA</span>
    <h1>__FROM__ <span class="arrow">→</span> __HEADING__</h1>
    <div class="meta"><span>main at <b class="sha">__SHA__</b></span><span>Checked <b>__DATE__</b></span><span>__RANGENOTE__</span></div>
    <div class="envs">__ENVS__</div>
    <nav class="jump" aria-label="Sections">
      <a href="#problems">Problems (__NPROB__)</a><a href="#premium">Premium</a><a href="#notes">Notes (__NNOTES__)</a><a href="#results">All results (__TOTAL__)</a><a href="#checklist">Manual checklist</a>
    </nav>
  </header>

  <section class="summary" aria-label="Summary">
    <div class="bar" role="img" aria-label="Results by status">__BAR__</div>
    <div class="counts">__TILES__</div>
    __UPDATE__
  </section>

  <section id="problems">
    <div class="shead"><h2>Problems found</h2><span class="sub">__PROBSUB__</span></div>
    <div class="problems">__PROBLEMS__</div>
  </section>

  <section id="premium">
    <div class="shead"><h2>Premium features</h2><span class="sub">Signed-in test account · __PREMSTATE__</span></div>
    __PREMIUM__
  </section>

  <section id="notes">
    <div class="shead"><h2>Notes</h2><span class="sub">__NOTESSUB__</span></div>
    <ul class="notes">__NOTES__</ul>
  </section>

  <section id="results">
    <div class="shead"><h2>All results</h2><span class="sub">Every check, as logged</span></div>
    <div class="filters">
      <div class="chips" role="group" aria-label="Status">__CHIPS__</div>
      <div class="frow">
        <div class="segs" role="group" aria-label="Platform">__PLATS__</div>
        <input class="search" id="q" type="search" placeholder="Search PR, feature or text" aria-label="Search results">
        <span class="shown" id="shown"></span>
      </div>
    </div>
    <div class="rows" id="rows">__ROWS__</div>
  </section>

  <section id="checklist">
    <div class="shead"><h2>Manual checklist</h2><span class="progress" id="ckprog">0 of __CKTOTAL__</span><span class="ckstatus" id="ckstatus">Loading saved ticks…</span></div>
    <div class="ckgrid">__CHECKLIST__</div>
  </section>

  <footer class="foot">Rendered from the session's results log by the <code>release-qa</code> skill's <code>render_qa.py</code>. PR links go to github.com/__REPO__.</footer>
</div>

<dialog id="lb" aria-label="Screenshot">
  <div class="lb-inner">
    <div class="lb-bar"><span class="cap" id="lbcap"></span><span><button type="button" id="lbprev">Previous</button> <button type="button" id="lbnext">Next</button> <button type="button" id="lbclose">Close</button></span></div>
    <img id="lbimg" alt="">
  </div>
</dialog>

<script>
(() => {
  // Lightbox
  const lb = document.getElementById('lb'), img = document.getElementById('lbimg'), cap = document.getElementById('lbcap');
  const prev = document.getElementById('lbprev'), next = document.getElementById('lbnext');
  let set = [], at = 0;
  const show = () => { const s = set[at]; img.src = s.src; img.alt = s.caption || 'Screenshot'; cap.textContent = (s.caption ? s.caption + ' · ' : '') + (at + 1) + ' of ' + set.length; prev.hidden = next.hidden = set.length < 2; };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shots]');
    if (!b) return;
    try { set = JSON.parse(b.dataset.shots); } catch { return; }
    if (!set.length) return;
    at = 0; show();
    if (lb.showModal) lb.showModal(); else lb.setAttribute('open', '');
  });
  prev.onclick = () => { at = (at - 1 + set.length) % set.length; show(); };
  next.onclick = () => { at = (at + 1) % set.length; show(); };
  document.getElementById('lbclose').onclick = () => lb.close();
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });

  // Results filters
  const rows = [...document.querySelectorAll('#rows .row')];
  const chips = [...document.querySelectorAll('.chip')], plats = [...document.querySelectorAll('.seg-btn')];
  const q = document.getElementById('q'), shown = document.getElementById('shown');
  let group = 'all', plat = 'all';
  const apply = () => {
    const term = q.value.trim().toLowerCase();
    let n = 0, first = true;
    for (const r of rows) {
      const ok = (group === 'all' || (group === 'fixed' ? r.dataset.fixed === '1' : r.dataset.group === group)) && (plat === 'all' || r.dataset.platform === plat) && (!term || r.dataset.search.includes(term));
      r.hidden = !ok; r.classList.toggle('first', ok && first);
      if (ok) { n++; first = false; }
    }
    shown.textContent = n + ' of ' + rows.length + ' shown';
  };
  chips.forEach((c) => c.addEventListener('click', () => { group = c.dataset.g; chips.forEach((x) => x.setAttribute('aria-pressed', String(x === c))); apply(); }));
  plats.forEach((c) => c.addEventListener('click', () => { plat = c.dataset.plat; plats.forEach((x) => x.setAttribute('aria-pressed', String(x === c))); apply(); }));
  q.addEventListener('input', apply);
  document.querySelectorAll('.count[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const c = chips.find((x) => x.dataset.g === b.dataset.jump); if (c) c.click();
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  apply();

  // Manual checklist, kept in the artifact's shared db: checklist/<item id> = {done, note}
  const items = [...document.querySelectorAll('.ck')];
  const status = document.getElementById('ckstatus'), prog = document.getElementById('ckprog');
  const byId = new Map(items.map((li) => [li.dataset.id, { li, cb: li.querySelector('input[type=checkbox]'), note: li.querySelector('.note') }]));
  const progress = () => { const n = items.filter((li) => li.querySelector('input[type=checkbox]').checked).length; prog.textContent = n + ' of ' + items.length; };
  const say = (t) => { status.textContent = t; };
  const lastSaved = new Map(), chains = new Map();
  let readOnly = false;
  const lock = (msg) => { readOnly = true; byId.forEach(({ cb, note }) => { cb.disabled = true; note.disabled = true; }); say(msg); };

  (async () => {
    let db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch { db = null; }
    if (!db) { say('Open this page on claude.ai, signed in, to tick items. Ticks are shared with everyone who can open it.'); return; }
    const save = (id) => {
      if (readOnly) return;
      const { cb, note, li } = byId.get(id);
      li.classList.toggle('done', cb.checked); progress();
      const body = { done: cb.checked, note: note.value.trim().slice(0, 300) };
      const key = JSON.stringify(body);
      if (lastSaved.get(id) === key) return;
      const p = (chains.get(id) || Promise.resolve())
        .then(() => db.doc('checklist/' + id).set(body))
        .then(() => { lastSaved.set(id, key); say('Saved. Ticks are shared with everyone who can open this page.'); })
        .catch((e) => { if (e && e.code === 'invalid_argument') lock('You can view this checklist but not change it.'); else say('Could not save the last change. Try again in a moment.'); });
      chains.set(id, p);
    };
    byId.forEach(({ cb, note }, id) => {
      cb.disabled = false; note.disabled = false;
      cb.addEventListener('change', () => save(id));
      note.addEventListener('change', () => save(id));
      note.addEventListener('keydown', (e) => { if (e.key === 'Enter') note.blur(); });
    });
    const timer = setTimeout(() => say('The saved ticks can’t be reached yet; what you see may be out of date.'), 10000);
    db.collection('checklist').onSnapshot((snap) => {
      if (!snap.metadata.fromCache) { clearTimeout(timer); if (!readOnly) say('Ticks are shared with everyone who can open this page.'); }
      for (const d of snap.docs) {
        const it = byId.get(d.id), data = d.data();
        if (!it || !data) continue;
        lastSaved.set(d.id, JSON.stringify({ done: !!data.done, note: String(data.note || '') }));
        it.cb.checked = !!data.done; it.li.classList.toggle('done', !!data.done);
        if (document.activeElement !== it.note) it.note.value = String(data.note || '');
      }
      progress();
    }, () => { clearTimeout(timer); say('The saved ticks could not be loaded.'); });
  })();
})();
</script>
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--results', required=True)
    ap.add_argument('--config', required=True)
    ap.add_argument('--images', action='append', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text(encoding='utf-8'))
    out = Path(a.out)
    shots = out / 'shots'
    shots.mkdir(parents=True, exist_ok=True)
    rows = parse(a.results)
    attach_evidence(rows, cfg, a.images, shots)
    page = render(rows, cfg)
    (out / 'index.html').write_text(page, encoding='utf-8')
    files = sorted(p.name for p in shots.iterdir())
    size = sum((shots / f).stat().st_size for f in files) + len(page.encode())
    print(json.dumps({'rows': len(rows), 'page': str(out / 'index.html'), 'shots': len(files), 'bytes': size}))


if __name__ == '__main__':
    main()
