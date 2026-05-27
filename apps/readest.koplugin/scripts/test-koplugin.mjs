#!/usr/bin/env node
/**
 * Run busted unit tests against apps/readest.koplugin under LuaJIT (the
 * runtime KOReader uses). Spec files live in `apps/readest.koplugin/spec/`
 * and are auto-discovered via `.busted` config.
 *
 * Invoked from `pnpm test:lua`. Soft-skips with a notice when busted or
 * luajit is not installed; CI installs both and runs unconditionally.
 *
 * Required toolchain (one-time):
 *   brew install luajit luarocks      (or apt-get install …)
 *   luarocks --lua-version=5.1 install busted
 *   luarocks --lua-version=5.1 install lsqlite3complete
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Script lives at apps/readest.koplugin/scripts/; one parent up is the
// koplugin root.
const KOPLUGIN_DIR = path.resolve(__dirname, '..');

if (!fs.existsSync(KOPLUGIN_DIR)) {
  console.error(`koplugin directory not found at ${KOPLUGIN_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(KOPLUGIN_DIR, 'spec'))) {
  console.log('No spec/ directory under apps/readest.koplugin — nothing to test.');
  process.exit(0);
}

const which = (cmd, env = process.env) =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { env });

// In CI a missing toolchain is a hard failure (exit 1); locally it's a
// soft skip (exit 0) so devs without busted installed don't get blocked.
// GitHub Actions sets CI=true; respect any other CI's convention too.
const HARD_FAIL = !!process.env.CI;
const onMissing = (tool, install_hint) => {
  const msg =
    `test:lua: ${tool} not found. ` +
    `Install via ${install_hint}.` +
    (HARD_FAIL ? '' : ' Skipping (set CI=1 to make this an error).');
  if (HARD_FAIL) {
    console.error(msg);
    process.exit(1);
  } else {
    console.warn(msg);
    process.exit(0);
  }
};

if (which('luajit').status !== 0) {
  onMissing(
    'luajit',
    '`brew install luajit` on macOS, `apt-get install luajit` on Linux',
  );
}

if (which('luarocks').status !== 0) {
  onMissing('luarocks', '`brew install luarocks` (or `apt-get install luarocks`)');
}

// `luarocks --lua-version=5.1 path` emits export lines for PATH, LUA_PATH,
// LUA_CPATH that point at the user's 5.1 rocks tree. pnpm's spawned shells
// don't source the user's rc files, so ~/.luarocks/bin is usually missing
// from PATH and `which busted` fails even when busted is installed. We
// re-inject these vars into the spawn env here so subsequent lookups +
// busted's own `require('busted.runner')` both succeed.
const lrPath = spawnSync('luarocks', ['--lua-version=5.1', 'path'], { encoding: 'utf8' });
if (lrPath.status !== 0) {
  if (HARD_FAIL) {
    console.error('test:lua: `luarocks --lua-version=5.1 path` failed.');
    process.exit(1);
  }
  console.warn('test:lua: `luarocks --lua-version=5.1 path` failed.');
  process.exit(0);
}
const env = { ...process.env };
for (const line of lrPath.stdout.split('\n')) {
  const m = line.match(/^export (LUA_PATH|LUA_CPATH|PATH)='(.*)'$/);
  if (m) {
    if (m[1] === 'PATH') {
      // luarocks's PATH already includes the rest of the user's PATH (it
      // re-emits the value it inherited), so an outright assignment is
      // safe and avoids a double-prepend.
      env.PATH = m[2];
    } else {
      env[m[1]] = m[2];
    }
  }
}

if (which('busted', env).status !== 0) {
  onMissing(
    'busted',
    '`luarocks --lua-version=5.1 install busted` ' +
      '(and `lsqlite3complete` for SQLite tests)',
  );
}

const luajitPath = which('luajit', env).stdout.toString().trim();
const r = spawnSync('busted', [`--lua=${luajitPath}`], {
  cwd: KOPLUGIN_DIR,
  stdio: 'inherit',
  env,
});
process.exit(r.status === null ? 1 : r.status);
