// Upload the committed Word Wise gloss packs + manifest to the cdn.readest.com
// R2 bucket under /wordwise/. Maintainer/CI tool — run after regenerating data.
//
//   WORDWISE_R2_BUCKET=<bucket> node scripts/sync-wordwise-r2.mjs
//
// Pack files get a one-year immutable cache (the app cache-busts via a ?v=<sha8>
// query); manifest.json gets a short max-age so new packs surface quickly. Packs
// upload first, manifest LAST, so the CDN manifest never points at a missing pack.
//
// Robustness: each `wrangler r2 object put` is a separate process, spawned with NO
// stdin (so it can't block on a prompt) and telemetry off. Some wrangler versions
// don't exit promptly after the upload when behind an HTTP proxy (the socket stays
// open), which would wedge a synchronous loop on the very first file. So we watch
// the output and, once "Upload complete" is printed, give wrangler a moment to exit
// and otherwise kill it and move on. A per-file timeout is the backstop; one failed
// file is logged and the batch continues, returning a non-zero exit if any failed.
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SRC_DIR = resolve('data/wordwise');
const PACK_CACHE = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE = 'public, max-age=300';
const SUCCESS_RE = /Upload complete/i;
const POST_SUCCESS_GRACE_MS = 2_000; // wait this long for a clean exit after success
const PER_FILE_TIMEOUT_MS = 120_000; // hard backstop per file

const uploadOne = (bucket, file) =>
  new Promise((resolveP) => {
    const cacheControl = file === 'manifest.json' ? MANIFEST_CACHE : PACK_CACHE;
    const key = `${bucket}/wordwise/${file}`;
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
  const bucket = process.env.WORDWISE_R2_BUCKET;
  if (!bucket) {
    throw new Error('WORDWISE_R2_BUCKET env var is required (the cdn.readest.com R2 bucket name)');
  }
  const all = readdirSync(SRC_DIR).filter((f) => f.endsWith('.json'));
  if (!all.includes('manifest.json')) {
    throw new Error('manifest.json missing — run `pnpm wordwise:manifest` first');
  }
  const ordered = [...all.filter((f) => f !== 'manifest.json').sort(), 'manifest.json'];

  let ok = 0;
  const failed = [];
  for (const file of ordered) {
    // Sequential: keep output readable and avoid hammering the proxy.
    // eslint-disable-next-line no-await-in-loop
    if (await uploadOne(bucket, file)) ok += 1;
    else failed.push(file);
  }

  console.log(`\nSynced ${ok}/${ordered.length} files to ${bucket}/wordwise/`);
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
