#!/usr/bin/env node
// `pnpm tauri <command> [tauri args] [-- cargo args]`.
//
// Every platform but Linux goes straight to the npm @tauri-apps/cli, which
// builds on the readest tauri fork (the wry runtime). On Linux the desktop
// commands (dev, build, bundle) run on the CEF runtime instead: this uses the
// tauri CLI published from upstream's `feat/cef` branch and adds what the CEF
// build needs on top of the normal tauri command line:
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
// Cargo.cef.lock, which is committed like Cargo.lock. The original is parked
// in Cargo.lock.wry meanwhile, created exclusively so two CEF commands in one
// checkout cannot swap over each other; if a run is killed hard (SIGKILL)
// before the swap back, `mv Cargo.lock.wry Cargo.lock` restores it.
//
// Mobile commands (`tauri android ...`, `tauri ios ...`) and the tauri
// webdriver test harness (scripts/test-tauri.sh, which needs WebKitWebDriver)
// keep the wry runtime on Linux too.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CEF_CLI = '@tauri-apps/cli-cef@3.0.0-alpha.26';
// Offline builds (Flatpak) cannot `pnpm dlx`; they point this at an unpacked
// copy of the CLI package's `tauri.js` instead.
const localCefCli = process.env['TAURI_CEF_CLI'];
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '../..');
const cargoConfig = path.join(appDir, 'src-tauri/.cargo/cef.toml');
const lockPath = path.join(repoRoot, 'Cargo.lock');
const cefLockPath = path.join(repoRoot, 'Cargo.cef.lock');
const savedLockPath = path.join(repoRoot, 'Cargo.lock.wry');

const [command, ...rest] = process.argv.slice(2);
const useCef = process.platform === 'linux' && ['dev', 'build', 'bundle'].includes(command);

const run = (file, args, cleanup = () => {}) => {
  const child = spawn(file, args, { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    cleanup();
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on('error', (error) => {
    cleanup();
    console.error(error);
    process.exit(1);
  });
};

if (!useCef) {
  const tauriCli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
  run('node', [tauriCli, ...process.argv.slice(2)]);
} else {
  const split = rest.indexOf('--');
  const tauriArgs = split === -1 ? rest : rest.slice(0, split);
  const cargoArgs = split === -1 ? [] : rest.slice(split + 1);
  const args = [
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

  try {
    fs.writeFileSync(savedLockPath, fs.readFileSync(lockPath), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error(
      `${savedLockPath} exists: another CEF build is running from this checkout, or an earlier ` +
        'one was killed before it could restore Cargo.lock. Wait for it to finish, or run ' +
        '`mv Cargo.lock.wry Cargo.lock`.',
    );
    process.exit(1);
  }
  if (fs.existsSync(cefLockPath)) {
    fs.copyFileSync(cefLockPath, lockPath);
  }
  let swapped = true;
  const restoreLock = () => {
    if (!swapped) return;
    fs.copyFileSync(lockPath, cefLockPath);
    fs.renameSync(savedLockPath, lockPath);
    swapped = false;
  };

  // Ctrl-C reaches the child through the process group; stay alive until it
  // has exited so the lock swap is undone.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {});
  }

  if (localCefCli) {
    run('node', [localCefCli, ...args], restoreLock);
  } else {
    run('pnpm', ['dlx', CEF_CLI, ...args], restoreLock);
  }
}
