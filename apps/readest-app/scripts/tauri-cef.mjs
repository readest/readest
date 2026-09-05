#!/usr/bin/env node
// Linux CEF build entry point: `pnpm tauri:cef dev|build [tauri args] [-- cargo args]`.
//
// Runs the tauri CLI published from upstream's `feat/cef` branch and, for
// dev/build/bundle, adds what the CEF build needs on top of the normal tauri
// command line:
//   - `--features cef` so the CLI bundles the CEF distribution and cargo
//     compiles the CEF runtime (`cef = ["tauri/cef"]` in src-tauri/Cargo.toml);
//   - `--no-default-features` (cargo side) to drop the `wry` runtime, see
//     src-tauri/Cargo.toml;
//   - `--config src-tauri/.cargo/cef.toml` (cargo side) to take tauri and the
//     plugins from the `feat/cef` branches instead of the readest fork.
//
// Cargo resolves that graph differently from the fork graph every other
// platform builds, and it can only write one Cargo.lock. So for the duration
// of the command the repo's Cargo.cef.lock is swapped in as Cargo.lock and the
// original is put back afterwards; the CEF resolution is saved back to
// Cargo.cef.lock, which is committed like Cargo.lock. If a run is killed hard
// (SIGKILL) before the swap back, `git checkout Cargo.lock` restores it.
//
// Nothing here runs for other platforms, which keep using `pnpm tauri`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = '@tauri-apps/cli-cef@3.0.0-alpha.26';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '../..');
const cargoConfig = path.join(appDir, 'src-tauri/.cargo/cef.toml');
const lockPath = path.join(repoRoot, 'Cargo.lock');
const cefLockPath = path.join(repoRoot, 'Cargo.cef.lock');

const [command, ...rest] = process.argv.slice(2);
const runsCargo = ['dev', 'build', 'bundle'].includes(command);

let args = [command, ...rest];
if (runsCargo) {
  const split = rest.indexOf('--');
  const tauriArgs = split === -1 ? rest : rest.slice(0, split);
  const cargoArgs = split === -1 ? [] : rest.slice(split + 1);
  args = [
    command,
    '--features',
    'cef',
    ...tauriArgs,
    '--',
    '--no-default-features',
    '--config',
    cargoConfig,
    ...cargoArgs,
  ];
}

let originalLock = null;
if (runsCargo) {
  originalLock = fs.readFileSync(lockPath);
  if (fs.existsSync(cefLockPath)) {
    fs.copyFileSync(cefLockPath, lockPath);
  }
}

const restoreLock = () => {
  if (originalLock === null) return;
  fs.copyFileSync(lockPath, cefLockPath);
  fs.writeFileSync(lockPath, originalLock);
  originalLock = null;
};

// Ctrl-C reaches the child through the process group; stay alive until it has
// exited so the lock swap is undone.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {});
}

const child = spawn('pnpm', ['dlx', CLI, ...args], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  restoreLock();
  process.exit(code ?? (signal ? 1 : 0));
});
child.on('error', (error) => {
  restoreLock();
  console.error(error);
  process.exit(1);
});
