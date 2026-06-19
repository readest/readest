#!/usr/bin/env node
/**
 * Package the built extension into a versioned, Chrome-Web-Store-ready zip.
 *
 * Invoked by `pnpm zip`, which builds first so the archive is never stale.
 * The zip root holds `manifest.json` directly — the layout the Web Store
 * dashboard expects — and drops the `.LICENSE.txt` banners webpack emits
 * plus macOS `.DS_Store` noise.
 *
 * Requires the `zip` CLI (present on macOS / Linux). This is a maintainer
 * packaging step, not part of the CI build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const MANIFEST = join(DIST, 'manifest.json');

if (!existsSync(MANIFEST)) {
  console.error('[zip] dist/manifest.json not found — run `pnpm build` first.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const out = join(ROOT, `send-to-readest-${version}.zip`);
if (existsSync(out)) rmSync(out);

// Zip the *contents* of dist/ (cwd: DIST) so manifest.json lands at the
// archive root rather than under a `dist/` prefix.
execFileSync('zip', ['-rq', out, '.', '-x', '*.DS_Store', '*.LICENSE.txt'], {
  cwd: DIST,
  stdio: 'inherit',
});

const kb = Math.round(statSync(out).size / 1024);
console.log(`[zip] send-to-readest-${version}.zip (${kb} KB) ready to upload`);
