#!/usr/bin/env node
/**
 * Build the LocalSend native libs for the KOReader plugin into
 * apps/readest.koplugin/libs/ (gitignored; the release workflow builds them
 * before zipping, see .github/workflows/release.yml).
 *
 *   node build-localsend-libs.mjs                 # every target this host can build
 *   node build-localsend-libs.mjs --only armv7    # Kindle .so only
 *   node build-localsend-libs.mjs --only arm64-mac
 *
 * armv7 needs: rustup target add armv7-unknown-linux-gnueabi
 *              cargo-zigbuild + zig (brew install zig && cargo install cargo-zigbuild,
 *              or pip3 install ziglang cargo-zigbuild)
 * arm64-mac needs: an aarch64 macOS host (plain cargo build).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const CRATE_DIR = path.join(PLUGIN_DIR, 'native', 'localsend-ffi');
const LIBS_DIR = path.join(PLUGIN_DIR, 'libs');

// Kindle (kindlepw2 toolchain) userland glibc floor; verified against the
// KOReader kindle release binaries. Bump ONLY if a readelf check of a
// current release shows a higher floor is safe.
//
// Observed 2026-08-13 against koreader-kindle-v2026.07.1.zip: `strings`
// over every shipped .so/binary (koreader/libs/*, koreader/common/*,
// luajit, dbclient, dropbear, fbink, scp, sdcv, sftp-server, tar, wmctrl,
// zsync2) tops out at GLIBC_2.12 (koreader/libs/libzmq.so.5).
const KINDLE_GLIBC = '2.12';

const TARGETS = {
  armv7: {
    triple: 'armv7-unknown-linux-gnueabi',
    cargo: ['zigbuild', '--release', '--target', `armv7-unknown-linux-gnueabi.${KINDLE_GLIBC}`],
    artifact: ['armv7-unknown-linux-gnueabi', 'release', 'liblocalsend_ffi.so'],
    out: 'liblocalsend-armv7.so',
    check() {
      const t = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
      if (!t.stdout || !t.stdout.includes('armv7-unknown-linux-gnueabi')) {
        return 'run: rustup target add armv7-unknown-linux-gnueabi';
      }
      // Note: `cargo zigbuild --version` always fails (cargo forwards
      // "zigbuild" as the subcommand name, and that subcommand has no
      // --version flag), so probe the cargo-zigbuild binary directly.
      if (spawnSync('cargo-zigbuild', ['--version']).status !== 0) {
        return 'install cargo-zigbuild + zig (brew install zig && cargo install cargo-zigbuild)';
      }
      return null;
    },
  },
  'arm64-mac': {
    triple: 'aarch64-apple-darwin',
    cargo: ['build', '--release', '--target', 'aarch64-apple-darwin'],
    artifact: ['aarch64-apple-darwin', 'release', 'liblocalsend_ffi.dylib'],
    out: 'liblocalsend-arm64.dylib',
    check() {
      if (process.platform !== 'darwin' || os.arch() !== 'arm64') {
        return 'needs an arm64 macOS host';
      }
      return null;
    },
  },
};

function parseArgs(argv) {
  const out = { only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (out.only && !TARGETS[out.only]) {
    console.error(`Unknown target ${out.only}; known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  return out;
}

function build(name) {
  const t = TARGETS[name];
  const missing = t.check();
  if (missing) {
    console.error(`skip ${name}: ${missing}`);
    return false;
  }
  console.log(`building ${name} (${t.triple})...`);
  const r = spawnSync('cargo', t.cargo, { cwd: CRATE_DIR, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`cargo failed for ${name}`);
    process.exit(1);
  }
  fs.mkdirSync(LIBS_DIR, { recursive: true });
  const src = path.join(CRATE_DIR, 'target', ...t.artifact);
  const dst = path.join(LIBS_DIR, t.out);
  fs.copyFileSync(src, dst);
  const kib = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`  -> ${dst} (${kib} KiB)`);
  return true;
}

const args = parseArgs(process.argv.slice(2));
const names = args.only ? [args.only] : Object.keys(TARGETS);
let built = 0;
for (const name of names) {
  if (build(name)) built++;
}
if (args.only && built === 0) process.exit(1);
console.log(`done: ${built}/${names.length} target(s) built`);
