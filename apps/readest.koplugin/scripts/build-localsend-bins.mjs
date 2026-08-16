#!/usr/bin/env node
/**
 * Build the LocalSend native helper binaries for the KOReader plugin into
 * apps/readest.koplugin/bin/ (gitignored; the release workflow builds them
 * before zipping, see .github/workflows/release.yml).
 *
 * These are STATIC MUSL binaries (armv7/arm64) with zero glibc dependency,
 * so there is no glibc floor to pin and no softfp/hardfloat split: one
 * armv7 binary runs on both ABIs because it is a standalone process spoken
 * to over a local TCP socket, not an FFI library linked into the host.
 *
 *   node build-localsend-bins.mjs                 # armv7 + arm64 (the device targets)
 *   node build-localsend-bins.mjs --only armv7     # Kindle/Kobo/generic armv7 Linux only
 *   node build-localsend-bins.mjs --only arm64     # reMarkable/generic arm64 Linux only
 *   node build-localsend-bins.mjs --only macos     # native arm64 macOS (KOReader emulator)
 *
 * armv7 needs: rustup target add armv7-unknown-linux-musleabi
 *              cargo-zigbuild + zig (brew install zig && cargo install cargo-zigbuild,
 *              or pip3 install ziglang cargo-zigbuild)
 * arm64 needs: rustup target add aarch64-unknown-linux-musl
 *              cargo-zigbuild + zig (same install as armv7)
 * macos needs: an aarch64 macOS host (plain cargo build).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const CRATE_DIR = path.join(PLUGIN_DIR, 'native', 'localsend-bin');
const BIN_DIR = path.join(PLUGIN_DIR, 'bin');

const TARGETS = {
  armv7: {
    triple: 'armv7-unknown-linux-musleabi',
    cargo: [
      'zigbuild',
      '--release',
      '--target',
      'armv7-unknown-linux-musleabi',
      '--bin',
      'localsend-helper',
    ],
    artifact: ['armv7-unknown-linux-musleabi', 'release', 'localsend-helper'],
    out: 'localsend-helper-armv7',
    check() {
      const t = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
      if (!t.stdout || !t.stdout.includes('armv7-unknown-linux-musleabi')) {
        return 'run: rustup target add armv7-unknown-linux-musleabi';
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
  arm64: {
    triple: 'aarch64-unknown-linux-musl',
    cargo: [
      'zigbuild',
      '--release',
      '--target',
      'aarch64-unknown-linux-musl',
      '--bin',
      'localsend-helper',
    ],
    artifact: ['aarch64-unknown-linux-musl', 'release', 'localsend-helper'],
    out: 'localsend-helper-arm64',
    check() {
      const t = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
      if (!t.stdout || !t.stdout.includes('aarch64-unknown-linux-musl')) {
        return 'run: rustup target add aarch64-unknown-linux-musl';
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
  macos: {
    triple: 'aarch64-apple-darwin',
    cargo: [
      'build',
      '--release',
      '--target',
      'aarch64-apple-darwin',
      '--bin',
      'localsend-helper',
    ],
    artifact: ['aarch64-apple-darwin', 'release', 'localsend-helper'],
    out: 'localsend-helper-macos',
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
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const src = path.join(CRATE_DIR, 'target', ...t.artifact);
  const dst = path.join(BIN_DIR, t.out);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  const kib = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`  -> ${dst} (${kib} KiB)`);
  return true;
}

const DEFAULT_TARGETS = ['armv7', 'arm64'];

const args = parseArgs(process.argv.slice(2));
const names = args.only ? [args.only] : DEFAULT_TARGETS;
let built = 0;
for (const name of names) {
  if (build(name)) built++;
}
if (args.only && built === 0) process.exit(1);
console.log(`done: ${built}/${names.length} target(s) built`);
