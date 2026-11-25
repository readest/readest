"""behavior.py BACKEND OUT LITE READEST: the first sync and a restart, on both apps, against backend.py's
server (BACKEND is its DIR, already up).

Each app (LITE: a Readest Lite release, READEST: a Readest desktop release built from the same
readest-app) starts signed in with an empty library: it pulls the books, then opens one
(scenarios/sync-first.json). Then it starts again on the home that left (sync-restart.json). Writes
OUT/{lite,cef}-{first,restart} (the runs), OUT/report-{first,restart} (compare.py: the screens and
the commands) and OUT/behavior.json: per run and app, the library entries, each book's files on disk,
the session (session-probe.js) and the downloads. Exits 1 when the apps differ in any of these.
"""
import json, os, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
backend, out, lite_bin, readest_bin = (os.path.abspath(a) for a in sys.argv[1:5])
apps = {'lite': (['python3', f'{here}/run_lite.py'], lite_bin, 'com.bilingify.readest-lite'),
        'cef': (['node', f'{here}/run_cef.mjs'], readest_bin, 'com.bilingify.readest')}


def state(d, app_id):
    books = f'{d}/home/.local/share/{app_id}/Readest/Books'
    lib = json.load(open(f'{books}/library.json')) if os.path.exists(f'{books}/library.json') else []
    titles = {b['hash']: b['title'] for b in lib}
    ipc = json.load(open(f'{d}/ipc.json'))
    downloads = [x['ok'] for x in ipc if x['cmd'] == 'download_file']
    return dict(
        library=sorted([b['title'], bool(b.get('downloadedAt')), bool(b.get('coverDownloadedAt')), bool(b.get('deletedAt'))]
                       for b in lib),
        files={titles.get(h, h): sorted(os.listdir(f'{books}/{h}')) for h in sorted(os.listdir(books))
               if os.path.isdir(f'{books}/{h}')} if os.path.isdir(books) else {},
        session=[json.loads(line)['probe'] for line in open(f'{d}/captures.jsonl')],
        downloads=dict(ok=downloads.count(True), failed=downloads.count(False)))


result, failed = {}, False
for run, scenario in (('first', 'sync-first'), ('restart', 'sync-restart')):
    for app, (runner, binary, _) in apps.items():
        env = dict(os.environ, PARITY_BACKEND=backend)
        if run == 'restart':
            env['PARITY_HOME'] = f'{out}/{app}-first/home'
        subprocess.run(runner + [f'{here}/scenarios/{scenario}.json', f'{out}/{app}-{run}', binary], env=env,
                       cwd=os.path.dirname(here), check=True)
    report = subprocess.run(['python3', f'{here}/compare.py', f'{out}/lite-{run}', f'{out}/cef-{run}', f'{out}/report-{run}'])
    got = {app: state(f'{out}/{app}-{run}', app_id) for app, (_, _, app_id) in apps.items()}
    differs = [k for k in got['lite'] if got['lite'][k] != got['cef'][k]]
    result[run] = dict(got, differs=differs)
    failed |= bool(differs) or report.returncode != 0
    print(f"behavior {run}: {'same' if not differs else 'differs in ' + ', '.join(differs)}")
    for k in differs:
        print(f"  {k}: lite {json.dumps(got['lite'][k])}\n  {' ' * len(k)}  cef  {json.dumps(got['cef'][k])}")
json.dump(result, open(f'{out}/behavior.json', 'w'), indent=1)
sys.exit(1 if failed else 0)
