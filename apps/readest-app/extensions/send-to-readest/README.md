# Send to Readest — browser extension

One-click capture of the current web page into your Readest library as a
**self-contained EPUB**. Built for Chromium-based browsers (Chrome, Edge,
Arc, Brave). Manifest V3.

## What it captures

For every page the user clips, the extension produces a single `.epub`:

- Article body via [@mozilla/readability](https://github.com/mozilla/readability)
  on the live, fully-rendered DOM — so paywalled / authenticated pages
  capture the content the user can actually see.
- Lazy-loaded images surfaced by walking the DOM and resolving `srcset`,
  `<picture>`/`<source>`, `data-src`, `data-original`, `data-srcset`,
  `data-lazy`, and `data-actualsrc` in that order of preference (the same
  set the server-side bundler in `src/services/send/conversion/assetBundler.ts`
  handles).
- Image bytes fetched by the **service worker** under the user's existing
  session (`credentials: 'include'`) and the extension's broad
  `host_permissions: ["<all_urls>"]` — CORS doesn't apply, paywalled CDN
  cookies do.
- A small bundled stylesheet (system fonts only — no remote fonts), so the
  EPUB never makes a network request when opened offline.
- Inline images stored under `OEBPS/images/<sha256>.<ext>`, deduplicated by
  hash so a hero shared between `<picture>` and `<img>` only ships once.

The EPUB is POSTed to **`POST /api/send/inbox/file`** with `kind=file`. The
server writes the bytes to R2 and inserts a `send_inbox` row; the next
Readest client to open drains the inbox and imports the EPUB as-is — no
further server-side conversion.

## Why client-side conversion

The previous version (`0.1.0`) sent only the page URL — the server then
tried to fetch and render it. That broke on:

- Paywalled / member-only content (server doesn't have the user's cookies).
- Bot-protected CDNs (Cloudflare, image hosts that gate on UA + Sec-Ch-Ua
  headers + JS challenges).
- Lazy-loaded images that never materialize without a real scroll.

Building the EPUB on the capturing client side-steps all three. See
[D5 in the Send to Readest plan](../../docs/) and Part 4a / Part 8 of the
plan for the original design.

## Architecture

```
popup (popup.ts)
   │  click "Send to Readest"
   ▼
service worker (background/service-worker.ts)
   │  chrome.scripting.executeScript({ files: ['content/capture.js'] })
   ▼
content script (content/capture.ts)  [runs in the page's tab]
   ├─ scrolls page once to materialize lazy images
   ├─ flattens open Shadow DOM (content/capture/shadow.ts)
   ├─ Readability extracts article body
   ├─ walks <img>/<picture>, rewrites src → placeholder tokens
   ├─ DOMPurify-sanitizes the article HTML
   └─ returns { meta, articleHtml, images:[{placeholder,url}] }
   ▼
service worker
   ├─ fetchAssets(images) — CORS-free, credentialed image downloads
   ├─ buildEpub — zip.js: mimetype, container, OPF, NCX, CSS, chapter, images
   └─ uploadEpub — POST /api/send/inbox/file with EPUB bytes
   ▼
server (src/pages/api/send/inbox/file.ts)
   ├─ putObject → R2 (inbox bucket, kind='file')
   └─ insert send_inbox row
   ▼
next Readest open → drainer imports the EPUB → book in library on all devices
```

A second always-on content script (`content/auth-bridge.ts`) runs only on
`web.readest.com` and copies the user's Supabase access token into the
extension's `chrome.storage.local` so the popup can authenticate to the
inbox endpoint without prompting for credentials. The extension never
stores a password or refresh token.

## Build

```bash
# From the extension directory:
pnpm install   # one-time — the extension is a pnpm workspace package
pnpm build     # produces dist/ ready to load unpacked
pnpm dev       # watch mode while developing
```

The build is webpack-based:

- `src/background/service-worker.ts` → `dist/background/service-worker.js`
  (bundles `@zip.js/zip.js`)
- `src/content/capture.ts` → `dist/content/capture.js`
  (bundles `@mozilla/readability` + `dompurify`)
- `src/content/auth-bridge.ts` → `dist/content/auth-bridge.js`
- `src/popup/popup.ts` → `dist/popup/popup.js`

`manifest.json`, `popup.html`, and `icons/*` are copied verbatim into
`dist/` by `copy-webpack-plugin`.

## Load it for development

1. `pnpm build` (or `pnpm dev` for watch mode).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this directory's `dist/` folder (not the
   project root).
4. Visit <https://web.readest.com> once and sign in so the auth-bridge
   content script captures the access token.
5. Click the extension's toolbar icon on any article page. The popup
   reflects each phase: capturing → fetching images → building EPUB →
   sending.

### Pointing the extension at a local Readest

The extension reads `chrome.storage.local.readestApiBase` if set, falling
back to `https://web.readest.com`. From the DevTools console of the
extension's background page:

```js
chrome.storage.local.set({ readestApiBase: 'http://localhost:3000' });
```

## Testing

Vitest exercises the extension's shell — upload (`X-Readest-*` headers, RFC
5987 encoding, error-code mapping, endpoint override), auth bridge
(`sb-*-auth-token` localStorage → `chrome.storage.local` sync, including
malformed JSON + storage-event rotation), `chrome.storage` auth helpers,
toolbar badge updates, the lazy-load scroll dance (incl.
`prefers-reduced-motion`), and the popup UI rendering for every progress
phase. From the `apps/readest-app` workspace root:

```bash
pnpm test:extension      # 47 shell tests, ~1 s
pnpm build-browser-ext   # production webpack build (catches alias / stub regressions)
pnpm test                # full suite — also runs the extension tests via vitest's default glob
```

The shared EPUB pipeline (`convertPageToEpub`) and the server's
`/api/send/inbox/file` endpoint have their own tests under
`apps/readest-app/src/__tests__/services/`. The unification regression
specifically lives in `send-convert-page-unified.test.ts`.

**CI coverage:** the GitHub Actions `test_web_app` job runs
`pnpm test:pr:web`, which invokes the full vitest suite (extension shell
tests included), the browser-test suite, and the extension's production
webpack build. A webpack-config or shared-pipeline regression fails the
job on its own line.

## Internationalisation

The extension uses **key-as-content** i18n (matches the readest-app's
`stubTranslation as _` convention): the English source string IS the
lookup key. Import as `_` at every call site to mirror the main repo:

```ts
import { translate as _ } from '../lib/i18n';

_('Send to Readest');
_('Sent — {count} images could not be fetched.', { count });
```

Two parallel translation surfaces:

| Folder | Scope | When it's read |
|---|---|---|
| `src/locales/<lang>.json` | 29 runtime UI strings — popup, errors, status, badges. `{ "<english source>": "<translation>" }`. | At runtime by the `_(...)` helper. Falls through to the English key when an entry is missing or set to the `__STRING_NOT_TRANSLATED__` sentinel. |
| `_locales/<lang>/messages.json` | Three manifest fields — `app_name`, `app_description`, `action_title` — referenced as `__MSG_*__` in `manifest.json`. | At install time + by the Chrome Web Store listing. Chrome falls back to `default_locale` (en) automatically, so a locale file is only needed when you want to override the toolbar tooltip / store copy. |

The full set of supported locales lives in
`apps/readest-app/i18n-langs.json`. The extension's extractor reads the
same file, so a locale added there ships in the extension automatically
on the next `pnpm i18n:extract` run.

### Extracting strings

After adding `_('...')` calls or `data-i18n="..."` attrs:

```bash
pnpm i18n:extract           # populates every src/locales/*.json with new keys
pnpm i18n:check              # exits non-zero if any bundle has untranslated entries
```

The extractor:

1. Reads the canonical locale list from
   `apps/readest-app/i18n-langs.json` and ensures a stub
   `src/locales/<lang>.json` exists for every entry (creates an empty
   `{}` for any missing locale).
2. Scans every `.ts`/`.tsx` (skipping `*.test.ts`) and every `.html` file
   under the extension.
3. Pulls source strings from `_('…')` calls AND `data-i18n` /
   `data-i18n-title` HTML attributes.
4. For every non-`en` locale: adds missing entries with
   `__STRING_NOT_TRANSLATED__` (same sentinel readest-app uses), keeps
   existing translations, sorts keys for deterministic diffs.
5. Regenerates `src/locales/index.ts` with one static import per locale
   bundle — the runtime helper reads its `bundles` map.
6. Mirrors the locale list into `_locales/<lang>/messages.json` stubs
   (Chrome's native i18n surface for manifest fields). Existing
   translations are never overwritten — only missing locales get
   created as `__STRING_NOT_TRANSLATED__` stubs.
7. Logs orphan entries (in the bundle but no longer in code) so a
   translator can decide whether to drop them.

The runtime helper filters sentinel entries at load time, so a
partially-translated bundle gracefully falls back to English per-key
instead of leaking placeholders into the UI.

### Adding a locale

To add a locale the extension ships in lockstep with the main app:

1. Add the code to `apps/readest-app/i18n-langs.json`.
2. `pnpm i18n:extract` from the extension dir — creates
   `src/locales/<code>.json` populated with `__STRING_NOT_TRANSLATED__`
   placeholders, regenerates `src/locales/index.ts`.
3. Hand-translate each value.
4. *(Optional)* Drop `_locales/<code>/messages.json` mirroring the en
   file if you want the toolbar tooltip / Chrome Web Store listing
   translated too. Chrome falls back to `en` when this is missing.
5. Rebuild — webpack picks up the new JSON via the regenerated index.

## Before publishing to the Chrome Web Store

- Replace the icon set (currently a 1:1 downscale of the Readest app icon)
  with extension-specific artwork.
- Add a screenshot bundle and a privacy disclosure: the extension reads the
  page DOM and fetches its image references; nothing is sent off-device
  except to the Readest inbox.
- Submit through the Chrome Web Store Developer Dashboard (review required).
