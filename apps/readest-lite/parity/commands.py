"""commands.py [DIST]: the Tauri commands Readest answers on Linux and Readest Lite doesn't.

Readest's bundle (DIST, default dist/) names every command its frontend can call: plugin commands as
`plugin:<plugin>|<command>`, the app's own as quoted names. Readest on Linux answers one when its
plugin is registered there (src-tauri/src/lib.rs, `#[cfg]` read for a Linux desktop) and an enabled
capability allows it, or when it is in its `generate_handler!` list. Lite answers one the same way,
from its own src-tauri. Each command Readest answers and Lite doesn't must be in
commands-missing.json, with why: this fails on one that isn't, and on a listed one Lite now answers.
"""
import glob, json, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
lite_dir = os.path.dirname(here)
readest_tauri = os.path.join(lite_dir, '../readest-app/src-tauri')
lite_tauri = os.path.join(lite_dir, 'src-tauri')
dist = sys.argv[1] if len(sys.argv) > 1 else os.path.join(lite_dir, 'dist')


def on_linux(cfg):
    """Whether `#[cfg(<cfg>)]` holds on a Linux desktop build without extra features."""
    def ev(s):
        s = s.strip()
        if m := re.fullmatch(r'(any|all|not)\((.*)\)', s, re.S):
            args, depth, cur = [], 0, ''
            for ch in m[2]:
                depth += (ch == '(') - (ch == ')')
                if ch == ',' and depth == 0:
                    args.append(cur); cur = ''
                else:
                    cur += ch
            vals = [ev(a) for a in args + [cur] if a.strip()]
            return any(vals) if m[1] == 'any' else all(vals) if m[1] == 'all' else not vals[0]
        if m := re.fullmatch(r'target_os\s*=\s*"(\w+)"', s):
            return m[1] == 'linux'
        return s in ('desktop', 'unix')  # mobile, windows, feature = "...", debug_assertions: no
    return ev(cfg)


def cfg_before(src, pos):
    """The `#[cfg(...)]` on the line before `pos`, or None."""
    prev = src[:src.rfind('\n', 0, pos)].rstrip().rsplit('\n', 1)[-1].strip()
    m = re.fullmatch(r'#\[cfg\((.*)\)\]', prev)
    return m[1] if m else None


def registered_plugins(lib_rs):
    """Plugins registered on Linux: `.plugin(tauri_plugin_x...)` under no cfg, or one that holds there."""
    src = open(lib_rs).read()
    out = set()
    for m in re.finditer(r'\.plugin\(\s*tauri_plugin_(\w+)', src):
        cfg = cfg_before(src, m.start())
        if cfg is None or on_linux(cfg):
            out.add(m[1].replace('_', '-'))
    return out


def handlers(path):
    """The commands in `generate_handler![...]` that are compiled on Linux."""
    src = open(path).read()
    out = set()
    for m in re.finditer(r'generate_handler!\[', src):
        depth, i = 1, m.end()
        while depth:
            depth += (src[i] == '[') - (src[i] == ']')
            i += 1
        body = src[m.end():i - 1]
        cfg = None
        for line in body.splitlines():
            line = line.strip().rstrip(',')
            if not line or line.startswith('//'):
                continue
            if c := re.fullmatch(r'#\[cfg\((.*)\)\]', line):
                cfg = c[1]
                continue
            if cfg is None or on_linux(cfg):
                out.add(line.split('::')[-1])
            cfg = None
    return out


def allowed(tauri_dir, plugins):
    """(plugin, command) pairs the enabled capabilities allow, for registered plugins only."""
    manifests = json.load(open(f'{tauri_dir}/gen/schemas/acl-manifests.json'))
    enabled = json.load(open(f'{tauri_dir}/tauri.conf.json')).get('app', {}).get('security', {}).get('capabilities')
    out, seen = set(), set()

    def grant(ident):
        if ident in seen:
            return
        seen.add(ident)
        plugin, _, perm = ident.rpartition(':')
        man = manifests.get(plugin)
        if man is None:
            return
        refs = []
        if perm == 'default':
            refs = man['default_permission']['permissions']
        elif perm in man.get('permission_sets', {}):
            refs = man['permission_sets'][perm]['permissions']
        elif perm in man.get('permissions', {}):
            out.update((plugin, c) for c in man['permissions'][perm]['commands']['allow'])
        elif perm.startswith('allow-'):  # a core plugin's per-command permission, not in the manifest
            out.add((plugin, perm[6:].replace('-', '_')))
        for r in refs:
            grant(r if ':' in r else f'{plugin}:{r}')

    for f in sorted(glob.glob(f'{tauri_dir}/capabilities/*.json')):
        cap = json.load(open(f))
        if enabled is not None and cap['identifier'] not in enabled:
            continue
        if cap.get('platforms') and 'linux' not in cap['platforms']:
            continue
        for p in cap['permissions']:
            grant(p if isinstance(p, str) else p['identifier'])
    return {(p, c) for p, c in out if p.startswith('core') or p in plugins}


def desktop_commands(plugin_dir):
    """A repo plugin's commands that work on a desktop: in its handler list, and not a desktop.rs
    stub that only returns UnsupportedPlatformError (the mobile-only ones)."""
    cmds = handlers(f'{plugin_dir}/src/lib.rs')
    desktop = f'{plugin_dir}/src/desktop.rs'
    if not os.path.exists(desktop):
        return cmds
    src = open(desktop).read()
    def block(s, start):  # the text inside the braces opened just before `start`
        depth, i = 1, start
        while depth:
            depth += (s[i] == '{') - (s[i] == '}')
            i += 1
        return s[start:i - 1]
    real, stubs = set(), set()
    for impl in re.finditer(r'^impl\b[^{;]*\{', src, re.M):  # each impl, under the cfg it has
        if (c := cfg_before(src, impl.start())) and not on_linux(c):
            continue
        body = block(src, impl.end())
        for fn in re.finditer(r'pub fn (\w+)\b[^{]*\{', body):
            if (c := cfg_before(body, fn.start())) and not on_linux(c):
                continue
            f = block(body, fn.end())
            (stubs if 'UnsupportedPlatformError' in f and 'Ok(' not in f else real).add(fn[1])
    return cmds - (stubs - real)


def answered(tauri_dir, main_rs, plugins):
    perms = allowed(tauri_dir, plugins)
    app = handlers(main_rs)
    own = {os.path.basename(d)[len('tauri-plugin-'):]: desktop_commands(d)
           for d in glob.glob(f'{tauri_dir}/plugins/tauri-plugin-*')}
    def answers(cmd):
        if m := re.fullmatch(r'plugin:([\w-]+)\|(\w+)', cmd):
            if m[1] in own and m[2] not in own[m[1]]:
                return False
            return (m[1], m[2]) in perms or (f'core:{m[1]}', m[2]) in perms
        return cmd in app
    return answers, app


if not os.path.isdir(dist):
    sys.exit(f'{dist}: no bundle (scripts/build-frontend.sh builds it)')
bundle = ''.join(open(f, errors='replace').read() for f in glob.glob(f'{dist}/**/*.js', recursive=True))
readest_plugins = registered_plugins(f'{readest_tauri}/src/lib.rs')
readest, readest_app = answered(readest_tauri, f'{readest_tauri}/src/lib.rs', readest_plugins)
lite_plugins = set(json.load(open(f'{lite_tauri}/gen/schemas/acl-manifests.json')))
lite, _ = answered(lite_tauri, f'{lite_tauri}/src/main.rs', lite_plugins)

called = {f'plugin:{p}|{c}' for p, c in re.findall(r'plugin:([\w-]+)\|(\w+)', bundle)}
called |= {c for c in readest_app if re.search(rf'["\'`]{re.escape(c)}["\'`]', bundle)}
missing = sorted(c for c in called if readest(c) and not lite(c))
# Readest's gen/schemas is written by its last build (and shared by every worktree): one for
# another platform has no manifest for some Linux plugins, whose commands then go uncounted.
manifests = set(json.load(open(f'{readest_tauri}/gen/schemas/acl-manifests.json')))
unbuilt = sorted(p for p in readest_plugins - manifests if any(c.startswith(f'plugin:{p}|') for c in called))
if unbuilt:
    print(f"warning: Readest's src-tauri/gen/schemas has no manifest for {', '.join(unbuilt)}, "
          'which its bundle calls: build Readest for Linux to count their commands')

known = json.load(open(f'{here}/commands-missing.json'))
def matches(key, cmd):  # a key ending in * matches every command it begins
    return cmd.startswith(key[:-1]) if key.endswith('*') else cmd == key
unlisted = [c for c in missing if not any(matches(k, c) for k in known)]
stale = [k for k in known if not any(matches(k, c) for c in missing)]

print(f'commands: Readest answers {sum(map(readest, called))} of the {len(called)} its bundle names on Linux; '
      f'Lite misses {len(missing)}, {len(missing) - len(unlisted)} of them listed in commands-missing.json')
for c in unlisted:
    print(f'  missing in Lite, not listed: {c}')
for k in stale:
    print(f'  listed but Lite answers it now (or Readest no longer calls it): {k}')
sys.exit(1 if unlisted or stale else 0)
