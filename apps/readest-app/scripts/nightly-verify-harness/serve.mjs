#!/usr/bin/env node
// Local nightly-updater verification harness (Tier 2 detection + Tier 4 invoke).
//
// `pnpm verify:nightly` serves crafted nightly/stable manifests + a test artifact
// on http://127.0.0.1:8788 so the in-app nightly check can be exercised on a
// desktop `pnpm tauri dev` build WITHOUT waiting on CI. See ./README.md.
//
// The manifest builders are also imported by the unit test
// `src/__tests__/helpers/updater.test.ts` ("harness scenarios") so the real
// `resolveNightlyUpdate` is asserted against these exact manifest shapes.
//
// The artifact is signed with a THROWAWAY minisign key (private key discarded),
// so it proves DETECTION and the verify-gate REJECT path. Accept-valid needs the
// real signing key (CI) and is covered by the Rust test
// `nightly_update::tests::verify_accepts_valid_signature`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = 8788;
const ARTIFACT = path.join(__dirname, 'artifacts', 'test.bin');
// scripts/nightly-verify-harness/ -> apps/readest-app/package.json
const PKG = path.join(__dirname, '..', '..', 'package.json');

// Throwaway fixtures (public; signed over artifacts/test.bin with a discarded key).
export const GOOD_SIG =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTYnBBOWFJeEtnL3RvRC83dEJEUXZONVFZM1hranhKTUZxQzllR2lGWnNjckZMbCtOa3RXMi80aFdDYUNDUkdOa0NqUjJUQkZDL2dqaUVTeURlNzI0cW1BcUlZY2ZsOGcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzgxNDE0MzExCWZpbGU6bnYuYmluCkQzajlpbVZPOXVDYXdna2JBVWZ0TTE4K1d1cWdEYWVYQzVraGh4U1ZuOGNSTDZaOU5zV093OEVDajBvV0JydVV5VGY2K0tkb0hBbGJHYWprK0NsNUN3PT0K';
export const BAD_SIG = 'AAAAdGhpcy1pcy1nYXJiYWdl';

export const ALL_KEYS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'windows-aarch64',
  'windows-x86_64-portable',
  'windows-aarch64-portable',
  'linux-x86_64-appimage',
  'linux-aarch64-appimage',
  'android-universal',
  'android-arm64',
];

export const baseVersion = () => JSON.parse(fs.readFileSync(PKG, 'utf8')).version.split('-')[0];

const platforms = (badsig) => {
  const signature = badsig ? BAD_SIG : GOOD_SIG;
  const url = `http://${HOST}:${PORT}/artifacts/test.bin`;
  return Object.fromEntries(ALL_KEYS.map((k) => [k, { url, signature }]));
};

// Future stamp guarantees the nightly is "newer than installed" regardless of
// the installed version (same base + nightly > stable, or > an older stamp).
export const buildNightlyManifest = (badsig = false) => ({
  version: `${baseVersion()}-2099010100`,
  pub_date: '2099-01-01T00:00:00+08:00',
  notes: 'Harness nightly build.',
  platforms: platforms(badsig),
});

export const buildStableManifest = (surpass = false) => {
  const [a, b, c] = baseVersion().split('.').map(Number);
  return {
    version: surpass ? `${a}.${b}.${c + 1}` : `${a}.${b}.${c}`,
    pub_date: '2099-01-01T00:00:00+08:00',
    notes: 'Harness stable build.',
    platforms: platforms(false),
  };
};

const json = (res, obj) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj, null, 2));
};

// Static switch on the literal request path — no user-controlled dynamic
// dispatch (the request path never selects which function is invoked).
const handleRequest = (req, res) => {
  const url = req.url.split('?')[0];
  console.log(`${req.method} ${url}`);
  switch (url) {
    case '/nightly/latest.json':
      return json(res, buildNightlyManifest(false));
    case '/nightly/latest-badsig.json':
      return json(res, buildNightlyManifest(true));
    case '/releases/latest.json':
      return json(res, buildStableManifest(false));
    case '/releases/latest-surpass.json':
      return json(res, buildStableManifest(true));
    case '/artifacts/test.bin': {
      const stream = fs.createReadStream(ARTIFACT);
      // Handle a missing/unreadable artifact instead of crashing the harness on
      // an unhandled stream 'error'.
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end('artifact error');
      });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return stream.pipe(res);
    }
    default:
      res.writeHead(404);
      return res.end('not found');
  }
};

const serve = () =>
  http.createServer(handleRequest).listen(PORT, HOST, () => {
      const base = baseVersion();
      console.log(`nightly harness on http://${HOST}:${PORT}`);
      console.log(`  nightly:        http://${HOST}:${PORT}/nightly/latest.json`);
      console.log(`  nightly badsig: http://${HOST}:${PORT}/nightly/latest-badsig.json`);
      console.log(`  stable:         http://${HOST}:${PORT}/releases/latest.json`);
      console.log(`  stable surpass: http://${HOST}:${PORT}/releases/latest-surpass.json`);
      console.log(`  base ${base} -> nightly ${base}-2099010100`);
    });

// Only start the server when run directly (so the unit test can import the builders).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) serve();
