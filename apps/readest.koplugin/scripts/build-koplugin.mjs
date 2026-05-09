#!/usr/bin/env node
/**
 * Build a Readest-${version}-1.koplugin.zip locally for sideloading
 * onto a real KOReader device. Mirrors the same exclusions the CI
 * release workflow uses (.github/workflows/release.yml: "create
 * KOReader plugin zip"):
 *   scripts/  — i18n + build helpers
 *   docs/     — design notes
 *   spec/     — busted test suite
 *   .busted   — busted runner config
 *
 * Usage:
 *   node apps/readest.koplugin/scripts/build-koplugin.js [--version X.Y.Z]
 *                                                       [--out PATH]
 *                                                       [--keep-meta]
 *
 * --version    Stamp _meta.lua with this version before zipping. If
 *              omitted, a "dev-<sha>" placeholder is used so the
 *              installed plugin is identifiable. _meta.lua is restored
 *              after zipping unless --keep-meta is passed.
 *
 * --out PATH   Destination zip path. Default:
 *              ./Readest-${version}-1.koplugin.zip
 *
 * --keep-meta  Don't restore _meta.lua after the build. Useful when
 *              chaining a release tag.
 *
 * Requirements: a working `zip` binary on PATH (macOS/Linux/WSL/git-bash).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const PLUGIN_NAME = path.basename(PLUGIN_DIR); // "readest.koplugin"
const APPS_DIR = path.resolve(PLUGIN_DIR, '..');
const META_FILE = path.join(PLUGIN_DIR, '_meta.lua');

function parseArgs(argv) {
  const out = { keepMeta: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--keep-meta') out.keepMeta = true;
    else if (a === '-h' || a === '--help') {
      console.log(`Usage:
  node build-koplugin.js [--version X.Y.Z] [--out PATH] [--keep-meta]

Default version: dev-<git-sha>
Default out:     ./Readest-<version>-1.koplugin.zip`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function shortGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: PLUGIN_DIR,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]);
  return r.status === 0;
}

function stampMeta(version) {
  const original = fs.readFileSync(META_FILE, 'utf8');
  // Inject `    version = "X",` immediately before the closing `}`.
  // Same regex shape as the CI step's perl one-liner; matches a `}`
  // at the start of a line and prepends the version line.
  const stamped = original.replace(/^}/m, `    version = "${version}",\n}`);
  fs.writeFileSync(META_FILE, stamped);
  return original;
}

function restoreMeta(original) {
  fs.writeFileSync(META_FILE, original);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version || `dev-${shortGitSha()}`;
  const out = path.resolve(args.out || `Readest-${version}-1.koplugin.zip`);

  if (!which('zip')) {
    console.error('error: `zip` not found on PATH. Install via your package manager.');
    process.exit(1);
  }

  // Remove an existing zip so `zip -r` doesn't accidentally append.
  if (fs.existsSync(out)) fs.unlinkSync(out);

  const originalMeta = stampMeta(version);
  let zipExit = 1;
  try {
    const exclusions = [
      `${PLUGIN_NAME}/scripts/*`,
      `${PLUGIN_NAME}/docs/*`,
      `${PLUGIN_NAME}/spec/*`,
      `${PLUGIN_NAME}/.busted`,
    ];
    const zipArgs = ['-r', out, PLUGIN_NAME, '-x', ...exclusions];
    console.log(`Building ${path.basename(out)} from ${PLUGIN_DIR}`);
    console.log(`  excluding: ${exclusions.join(', ')}`);
    const r = spawnSync('zip', zipArgs, {
      cwd: APPS_DIR,
      stdio: 'inherit',
    });
    zipExit = r.status === null ? 1 : r.status;
  } finally {
    if (!args.keepMeta) restoreMeta(originalMeta);
  }

  if (zipExit !== 0) {
    console.error(`zip exited with code ${zipExit}`);
    process.exit(zipExit);
  }
  const stat = fs.statSync(out);
  console.log(`✓ ${out} (${(stat.size / 1024).toFixed(1)} KiB)`);
}

main();
