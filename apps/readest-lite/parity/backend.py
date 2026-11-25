"""backend.py up DIR [BOOK...] | init DIR | down DIR: a local Readest server for behavior runs.

`up` starts the repo's self-host stack (docker/compose.yaml: Postgres, GoTrue, PostgREST, Kong on
:8000) under the compose project readest-parity, S3 storage on :9000 (SeaweedFS, open to any
request: quay.io refuses MinIO's image here and Docker Hub no longer has it), and readest-app's dev
server on :3210 against them. It signs up one user and uploads each BOOK with a cover, as another device would:
the book and the cover through /api/storage/upload, the book's row through /api/sync. DIR gets a
copy of docker/, the dev server's log, and backend.json (the runtime config that points an app at
this server, and the books). `init DIR` prints the script run_lite.py and run_cef.mjs start an app
with when PARITY_BACKEND is DIR: that config, and the user signed in with a session of the app's
own (two apps sharing one would sign each other out when one rotates its refresh token).
`down` stops it all and deletes the stack's data.
"""
import base64, hashlib, hmac, json, os, secrets, shutil, signal, subprocess, sys, time, urllib.request
from io import BytesIO

here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.abspath(f'{here}/../../..')
app_dir = f'{repo}/apps/readest-app'
PROJECT, KONG, API, S3 = 'readest-parity', 'http://localhost:8000', 'http://localhost:3210', 'http://localhost:9000'
S3_CONTAINER = f'{PROJECT}-s3'
EMAIL, PASSWORD = 'parity@example.com', 'parity-password-1'


def jwt(payload, secret):
    enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
    head = enc(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()) + '.' + enc(json.dumps(payload).encode())
    return head + '.' + enc(hmac.new(secret.encode(), head.encode(), hashlib.sha256).digest())


def request(method, url, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={
        **({'Content-Type': 'application/json'} if body is not None else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            text = res.read().decode() or 'null'
            return json.loads(text) if 'json' in res.headers.get('Content-Type', '') else text
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {url.split("?")[0]}: {e.code} {e.read().decode(errors="replace")[:500]}') from None


def wait(what, check, timeout):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if check():
                return
        except Exception:
            pass
        time.sleep(2)
    sys.exit(f'{what}: not up after {timeout} s')


def compose(d, *args):
    subprocess.run(['docker', 'compose', '-p', PROJECT, '--env-file', '.env', *args], cwd=f'{d}/docker', check=True)


def partial_md5(path):
    """Readest's book hash (src/utils/md5.ts partialMD5: KOReader's partial MD5)."""
    size, h = os.path.getsize(path), hashlib.md5()
    with open(path, 'rb') as f:
        for i in range(-1, 11):
            start = min(size, 1024 << (2 * i)) if i >= 0 else 0  # JS: 1024 << -2 is 0
            if start >= size:
                break
            f.seek(start)
            h.update(f.read(min(start + 1024, size) - start))
    return h.hexdigest()


def cover_png(title):
    from PIL import Image, ImageDraw
    im = Image.new('L', (300, 450), 90)
    ImageDraw.Draw(im).multiline_text((24, 40), '\n'.join(title[i:i + 14] for i in range(0, 42, 14)), fill=250)
    out = BytesIO()
    im.save(out, 'PNG')
    return out.getvalue()


def up(d, books):
    down(d)
    os.makedirs(d, exist_ok=True)
    shutil.rmtree(f'{d}/docker', ignore_errors=True)
    shutil.copytree(f'{repo}/docker', f'{d}/docker')
    secret = secrets.token_hex(24)
    env = dict(line.split('=', 1) for line in open(f'{repo}/docker/.env.example').read().splitlines()
               if '=' in line and not line.startswith('#'))
    env.update(JWT_SECRET=secret, POSTGRES_PASSWORD=secrets.token_hex(20),
               ANON_KEY=jwt({'role': 'anon', 'iss': 'supabase'}, secret),
               SERVICE_ROLE_KEY=jwt({'role': 'service_role', 'iss': 'supabase'}, secret))
    open(f'{d}/docker/.env', 'w').write(''.join(f'{k}={v}\n' for k, v in env.items()))
    compose(d, 'up', '-d', 'db', 'kong', 'auth', 'rest')
    subprocess.run(['docker', 'rm', '-f', S3_CONTAINER], capture_output=True)
    subprocess.run(['docker', 'run', '-d', '--name', S3_CONTAINER, '-p', '127.0.0.1:9000:8333', 'chrislusf/seaweedfs',
                    'mini', '-dir=/data', '-ip=127.0.0.1', '-master.telemetry=false'], check=True, capture_output=True)
    wait('S3', lambda: request('PUT', f"{S3}/{env['S3_BUCKET_NAME']}", raw=b'') is not None, 120)
    anon = {'apikey': env['ANON_KEY']}
    wait('GoTrue', lambda: request('GET', f'{KONG}/auth/v1/health', headers=anon), 300)

    server_env = {**os.environ, 'SUPABASE_URL': KONG, 'NEXT_PUBLIC_SUPABASE_URL': KONG, 'SUPABASE_PUBLIC_URL': KONG,
                  'SUPABASE_ANON_KEY': env['ANON_KEY'], 'NEXT_PUBLIC_SUPABASE_ANON_KEY': env['ANON_KEY'],
                  'SUPABASE_ADMIN_KEY': env['SERVICE_ROLE_KEY'], 'SELF_HOSTED': 'true',
                  'OBJECT_STORAGE_TYPE': 's3', 'S3_ENDPOINT': S3, 'S3_PUBLIC_ENDPOINT': S3,
                  'S3_REGION': 'us-east-1', 'S3_BUCKET_NAME': env['S3_BUCKET_NAME'],
                  'S3_ACCESS_KEY_ID': 'parity', 'S3_SECRET_ACCESS_KEY': 'parity',
                  'STORAGE_FIXED_QUOTA': env['STORAGE_FIXED_QUOTA'],
                  # Otherwise the AWS SDK signs an upload URL with the CRC32 of an empty body, which
                  # SeaweedFS checks (BadDigest) and MinIO doesn't.
                  'AWS_REQUEST_CHECKSUM_CALCULATION': 'WHEN_REQUIRED'}
    # Restarted whenever it exits: Next 16.4.2's dev server stops once on an upgrade notice, at
    # any point after it starts serving.
    log = open(f'{d}/dev-web.log', 'a')
    server = subprocess.Popen(['sh', '-c', 'while :; do pnpm exec dotenv -e .env.web -- next dev -p 3210; sleep 1; done'],
                              cwd=app_dir, env=server_env, stdout=log, stderr=log, start_new_session=True)
    open(f'{d}/dev-web.pid', 'w').write(str(server.pid))
    def answers():
        try:
            urllib.request.urlopen(f'{API}/api/sync', timeout=120)
        except urllib.error.HTTPError:
            return True  # the route answered (401 without a token)
    wait('dev server', answers, 600)

    session = request('POST', f'{KONG}/auth/v1/signup', {'email': EMAIL, 'password': PASSWORD}, anon)
    session.setdefault('expires_at', int(time.time()) + session['expires_in'])
    auth = {'Authorization': f"Bearer {session['access_token']}"}

    seeded, now = [], int(time.time() * 1000)
    for k, path in enumerate(books):
        h, ext = partial_md5(path), os.path.splitext(path)[1].lstrip('.').lower()
        title = os.path.splitext(os.path.basename(path))[0]
        files = [(f'Readest/Books/{h}/{h}.{ext}', open(path, 'rb').read()), (f'Readest/Books/{h}/cover.png', cover_png(title))]
        for name, data in files:
            res = request('POST', f'{API}/api/storage/upload', {'fileName': name, 'fileSize': len(data), 'bookHash': h}, auth)
            request('PUT', res['uploadUrl'], raw=data)
        book = dict(hash=h, format={'epub': 'EPUB', 'pdf': 'PDF'}[ext], title=title, author='Parity',
                    createdAt=now + k, updatedAt=now + k, uploadedAt=now + k)
        request('POST', f'{API}/api/sync', {'books': [book]}, auth)
        seeded.append(dict(hash=h, title=title))
    json.dump(dict(runtime=dict(supabaseUrl=KONG, supabaseAnonKey=env['ANON_KEY'], apiBaseUrl=API,
                                objectStorageType='s3', selfHosted=True), books=seeded),
              open(f'{d}/backend.json', 'w'), indent=1)
    print(f'backend up: {len(seeded)} books for {EMAIL} -> {d}/backend.json')


def init(d):
    runtime = json.load(open(f'{d}/backend.json'))['runtime']
    s = request('POST', f'{KONG}/auth/v1/token?grant_type=password', {'email': EMAIL, 'password': PASSWORD},
                {'apikey': runtime['supabaseAnonKey']})
    s.setdefault('expires_at', int(time.time()) + s['expires_in'])
    # supabase-js keeps the session under sb-<first host label>-auth-token; AuthContext keeps the rest.
    keys = {'sb-localhost-auth-token': json.dumps(s), 'token': s['access_token'],
            'refresh_token': s['refresh_token'], 'user': json.dumps(s['user'])}
    print(f"""window.__READEST_RUNTIME_CONFIG = {json.dumps(runtime)};
// Signed in as Readest's sign-in leaves it, unless the app kept a session from an earlier start.
try {{
  if (window === window.top && !localStorage.getItem('sb-localhost-auth-token')) {{
    for (const [k, v] of Object.entries({json.dumps(keys)})) localStorage.setItem(k, v);
    window.__paritySeeded = true;
  }}
}} catch {{}}
""")


def down(d):
    try:
        os.killpg(int(open(f'{d}/dev-web.pid').read()), signal.SIGTERM)
    except (OSError, ValueError):
        pass
    subprocess.run(['docker', 'rm', '-f', S3_CONTAINER], capture_output=True)
    if os.path.exists(f'{d}/docker/.env'):
        compose(d, 'down', '-v')


if __name__ == '__main__':
    cmd, d = sys.argv[1], os.path.abspath(sys.argv[2])
    {'up': lambda: up(d, sys.argv[3:]), 'init': lambda: init(d), 'down': lambda: down(d)}[cmd]()
