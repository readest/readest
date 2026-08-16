// Upload the committed Word Lens gloss packs + manifest to the cdn.readest.com
// R2 bucket under /wordlens/. Maintainer/CI tool — run after regenerating data.
//
//   WORDLENS_R2_BUCKET=<bucket> node scripts/sync-wordlens-r2.mjs [--force]
//
// INCREMENTAL by default: a data refresh usually touches one pair, so re-uploading
// all ~20 MB is waste. The published manifest already carries every pack's sha256,
// so we fetch it and upload only the packs that are new or changed (planSync). If
// it can't be fetched (first sync, network), we fall back to uploading everything;
// --force does the same on demand (e.g. an object was deleted from the bucket).
//
// Pack files get a one-year immutable cache (the app cache-busts via a ?v=<sha8>
// query); manifest.json gets a short max-age so new packs surface quickly. Packs
// upload first, manifest LAST, so the CDN manifest never points at a missing pack —
// and it is SKIPPED entirely if any pack failed, so clients never see a manifest
// whose sha256 references a pack the bucket doesn't have.
//
// Robustness: each `wrangler r2 object put` is a separate process, spawned with NO
// stdin (so it can't block on a prompt) and telemetry off. Some wrangler versions
// don't exit promptly after the upload when behind an HTTP proxy (the socket stays
// open), which would wedge a synchronous loop on the very first file. So we watch
// the output and, once "Upload complete" is printed, give wrangler a moment to exit
// and otherwise kill it and move on. A per-file timeout is the backstop; one failed
// file is logged and the batch continues, returning a non-zero exit if any failed.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DIR = resolve('data/wordlens');
const MANIFEST_FILE = 'manifest.json';
// Mirrors WORDLENS_CDN_BASE in src/services/wordlens/glossPacks.ts (the URL clients read).
const CDN_BASE = process.env.WORDLENS_CDN_BASE || 'https://cdn.readest.com/wordlens';
const PACK_CACHE = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE = 'public, max-age=300';
const SUCCESS_RE = /Upload complete/i;
const POST_SUCCESS_GRACE_MS = 2_000; // wait this long for a clean exit after success
const PER_FILE_TIMEOUT_MS = 120_000; // hard backstop per file

// Which pack files need uploading: those whose sha256 is missing from, or differs
// from, the manifest already published on the CDN. `remote` null (unreachable) or
// `force` means "upload every local pack". Sorted for stable output; manifest.json
// is not included — the caller always uploads it last. A pack the CDN still has but
// the local manifest dropped is left alone: the new manifest stops referencing it.
export function planSync(local, remote, { force = false } = {}) {
  const localPacks = local?.packs ?? [];
  const files = localPacks.map((p) => p.file).sort();
  if (force || !remote) return files;
  const remoteSha = new Map((remote.packs ?? []).map((p) => [p.file, p.sha256]));
  return localPacks
    .filter((p) => remoteSha.get(p.file) !== p.sha256)
    .map((p) => p.file)
    .sort();
}

// What clients actually act on: the schema version, each pack's source/target (how
// resolvePack routes a book language to a pack) and its file/sha256 (what gets fetched
// and cache-busted). Order and derived fields (bytes, entries) are ignored, so a
// manifest regenerated with identical content never triggers a pointless upload.
// source/target are redundant today — packEntry reads them from the pack's meta, which
// sha256 covers — but they are what routing depends on, so the key states it outright.
const manifestKey = (m) =>
  JSON.stringify([
    m?.schemaVersion ?? null,
    (m?.packs ?? []).map((p) => [p.source, p.target, p.file, p.sha256]).sort(),
  ]);

// Does the manifest itself need republishing? planSync can't answer this: RETIRING a
// pair changes the manifest while leaving every remaining pack byte-identical, so a
// run with nothing to upload must still publish, or the CDN keeps advertising a pack
// we dropped. A null remote (unreachable) always counts as changed.
export function manifestChanged(local, remote) {
  return !remote || manifestKey(local) !== manifestKey(remote);
}

// The manifest currently published on the CDN, or null if it can't be read (first
// sync, offline, 404). Null makes planSync fall back to a full upload.
async function fetchRemoteManifest() {
  try {
    const res = await fetch(`${CDN_BASE}/${MANIFEST_FILE}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const uploadOne = (bucket, file) =>
  new Promise((resolveP) => {
    const cacheControl = file === 'manifest.json' ? MANIFEST_CACHE : PACK_CACHE;
    const key = `${bucket}/wordlens/${file}`;
    console.log(`Uploading ${file} -> ${key}`);
    const child = spawn(
      'wrangler',
      [
        'r2', 'object', 'put', key,
        '--file', resolve(SRC_DIR, file),
        '--remote',
        '--content-type', 'application/json',
        '--cache-control', cacheControl,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );

    let out = '';
    let sawSuccess = false;
    let settled = false;
    let graceTimer = null;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(graceTimer);
      if (!child.killed) child.kill('SIGKILL');
      resolveP(success);
    };
    const onData = (d) => {
      const s = d.toString();
      process.stdout.write(s);
      out += s;
      if (!sawSuccess && SUCCESS_RE.test(out)) {
        sawSuccess = true;
        // Upload landed. Let wrangler exit on its own; kill it if it hangs (proxy).
        graceTimer = setTimeout(() => finish(true), POST_SUCCESS_GRACE_MS);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const hardTimer = setTimeout(() => {
      console.error(`  ✗ ${file}: timed out after ${PER_FILE_TIMEOUT_MS / 1000}s`);
      finish(sawSuccess);
    }, PER_FILE_TIMEOUT_MS);
    child.on('exit', (code) => {
      const success = code === 0 || sawSuccess;
      if (!success) console.error(`  ✗ ${file}: wrangler exited ${code}`);
      finish(success);
    });
    child.on('error', (e) => {
      console.error(`  ✗ ${file}: ${e.message}`);
      finish(false);
    });
  });

async function main() {
  const bucket = process.env.WORDLENS_R2_BUCKET;
  if (!bucket) {
    throw new Error('WORDLENS_R2_BUCKET env var is required (the cdn.readest.com R2 bucket name)');
  }
  const force = process.argv.slice(2).includes('--force');
  let local;
  try {
    local = JSON.parse(readFileSync(resolve(SRC_DIR, MANIFEST_FILE), 'utf8'));
  } catch {
    throw new Error('manifest.json missing — run `pnpm wordlens:manifest` first');
  }
  const remote = force ? null : await fetchRemoteManifest();
  if (!force && !remote) console.log('Remote manifest unavailable — uploading every pack.');
  const packs = planSync(local, remote, { force });
  if (!packs.length && !manifestChanged(local, remote)) {
    console.log(`Everything on ${bucket}/wordlens/ is already up to date.`);
    return;
  }
  if (packs.length) {
    console.log(`Uploading ${packs.length}/${local.packs.length} packs: ${packs.join(', ')}`);
  } else {
    console.log(`No pack changed; republishing ${MANIFEST_FILE} only.`);
  }

  let ok = 0;
  const failed = [];
  for (const file of packs) {
    // Sequential: keep output readable and avoid hammering the proxy.
    // eslint-disable-next-line no-await-in-loop
    if (await uploadOne(bucket, file)) ok += 1;
    else failed.push(file);
  }

  // Manifest LAST, and only when every pack landed — publishing it after a failure
  // would point clients at a pack sha256 the bucket doesn't have.
  if (failed.length) {
    console.error(`\nFailed: ${failed.join(', ')}`);
    console.error(`Skipped ${MANIFEST_FILE} — rerun to publish once the packs upload.`);
    process.exit(1);
  }
  if (!(await uploadOne(bucket, MANIFEST_FILE))) {
    console.error(`\nFailed: ${MANIFEST_FILE}`);
    process.exit(1);
  }
  console.log(`\nSynced ${ok} pack(s) + ${MANIFEST_FILE} to ${bucket}/wordlens/`);
}

// Only run the CLI when executed directly, not when imported by the unit tests.
// pathToFileURL rather than `file://${argv[1]}`: the latter mismatches on Windows
// paths and on URL-reserved characters in the path, which would silently turn a
// real `pnpm wordlens:sync` into a no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
