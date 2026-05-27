#!/usr/bin/env node
/**
 * Syntax-check every Lua file in apps/readest.koplugin against LuaJIT (the
 * runtime KOReader uses). `luajit -b <src> /dev/null` parses the source and
 * emits bytecode to /dev/null, returning non-zero on any syntax error without
 * executing the file. We use LuaJIT specifically — not stock Lua — because
 * the koplugin relies on LuaJIT-only features (`ffi/*`) and stock luac
 * silently accepts a few constructs LuaJIT rejects (e.g. `<const>`).
 *
 * Invoked from `pnpm lint:lua`. Soft-skips with a notice when luajit is not
 * installed; CI installs luajit and runs unconditionally.
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

// Recurse into subdirectories so files under `library/` and `spec/` get
// syntax-checked too. Skip dotfiles/dirs (e.g. `.busted`) and `node_modules`
// in case anyone vendors a JS dep here later.
function collectLuaFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectLuaFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.lua')) {
      out.push(full);
    }
  }
  return out;
}

const luaFiles = collectLuaFiles(KOPLUGIN_DIR).sort();

if (luaFiles.length === 0) {
  console.log('No .lua files to check.');
  process.exit(0);
}

const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['luajit']);
if (which.status !== 0) {
  console.warn(
    'lint:lua: luajit not found, skipping koplugin syntax check. ' +
      'Install LuaJIT (e.g. `brew install luajit` on macOS, `apt-get install luajit` on Linux) ' +
      'to enable this check locally. CI runs it unconditionally.',
  );
  process.exit(0);
}

const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
let failed = 0;
for (const file of luaFiles) {
  const r = spawnSync('luajit', ['-b', file, devNull], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
