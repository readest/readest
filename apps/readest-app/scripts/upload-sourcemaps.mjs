// Sentry browser source maps for the Tauri export build.
//
// Runs after `next build` (see the `build` script). `productionBrowserSourceMaps`
// makes Next emit `.js.map` files next to the chunks in `out/_next/static`; this
// script injects Sentry debug IDs into the chunks + maps, uploads the maps, then
// strips the `.map` files so they never ship inside the app bundle.
//
// The injected debug IDs let Sentry symbolicate regardless of the served host
// (chunks load from `tauri.localhost`), and we also associate the upload with the
// release (`Readest@<version>`, matching sentry_config.rs::sentry_release) and a
// host-agnostic `~/_next/static` URL prefix as a fallback matcher.
//
// No-op when SENTRY_AUTH_TOKEN is absent (local + fork builds): the maps are
// still stripped so the output is identical to before. Any Sentry failure is
// logged but never fails the build — crash reporting must not block a release.
//
// Set KEEP_SOURCEMAPS=1 to keep the maps in the bundle instead (see the
// `dev-ios` / `dev-android` / `dev-macos` scripts): local devtools then resolve
// minified frames to real sources.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(appDir, 'out', '_next', 'static');

// Resolve a config value from the process env, falling back to `.env.local` then
// `.env` (mirrors how build.rs resolves SENTRY_DSN).
const readEnv = (key) => {
  if (process.env[key]) return process.env[key];
  for (const file of ['.env.local', '.env']) {
    const p = path.join(appDir, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
};

// Drop the `//# sourceMappingURL=` comment Turbopack appends to each chunk.
// Left behind after the maps are deleted, it makes every devtools session fetch
// a missing `.js.map` — the asset protocol answers with HTML, which the webview
// reports as a source map parse error. sentry-cli's `//# debugId=` line stays:
// Sentry matches the uploaded maps by it.
export const stripSourceMappingComment = (code) =>
  code.replace(/\n\/\/# sourceMappingURL=[^\n]*/g, '');

// Recursively delete every `*.js.map` under `dir` and drop the now-dangling
// comment from every `*.js`. Turbopack names a map after a different hash than
// the chunk pointing at it, so the comment cannot be matched to a chunk by file
// name — every chunk under `dir` loses its map here, so every chunk is rewritten.
export const stripMaps = (dir) => {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) removed += stripMaps(full);
    else if (entry.endsWith('.js.map')) {
      rmSync(full);
      removed += 1;
    } else if (entry.endsWith('.js')) {
      const code = readFileSync(full, 'utf8');
      const stripped = stripSourceMappingComment(code);
      if (stripped !== code) writeFileSync(full, stripped);
    }
  }
  return removed;
};

const main = () => {
  if (!existsSync(staticDir)) {
    // Not an export build (e.g. `build-web`); nothing to do.
    return;
  }

  const authToken = readEnv('SENTRY_AUTH_TOKEN');

  if (authToken) {
    const org = readEnv('SENTRY_ORG') || 'readest';
    const project = readEnv('SENTRY_PROJECT') || 'readest';
    const require = createRequire(import.meta.url);
    const version = require(path.join(appDir, 'package.json')).version;
    const release = `Readest@${version}`;

    // The sentry-cli binary shipped by the @sentry/cli package.
    const bin = require('@sentry/cli').getPath();
    const env = {
      ...process.env,
      SENTRY_AUTH_TOKEN: authToken,
      SENTRY_ORG: org,
      SENTRY_PROJECT: project,
    };
    const run = (args) => execFileSync(bin, args, { cwd: appDir, env, stdio: 'inherit' });

    try {
      run(['sourcemaps', 'inject', staticDir]);
      run([
        'sourcemaps',
        'upload',
        '--release',
        release,
        '--url-prefix',
        '~/_next/static',
        staticDir,
      ]);
      console.log(`Sentry: uploaded source maps for ${release}.`);
    } catch (err) {
      // Never fail the build over crash-reporting plumbing.
      console.warn('Sentry: source map upload failed, continuing build:', err?.message ?? err);
    }
  } else {
    console.log('Sentry: SENTRY_AUTH_TOKEN unset, skipping source map upload.');
  }

  if (process.env['KEEP_SOURCEMAPS'] === '1') {
    console.log('Sentry: KEEP_SOURCEMAPS=1, keeping the .js.map files in the app bundle.');
    return;
  }

  const removed = stripMaps(staticDir);
  console.log(`Sentry: stripped ${removed} .js.map file(s) from the app bundle.`);
};

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
