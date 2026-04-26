# Citadel architecture audit (Readest fork baseline)

**Scope:** Read-only survey of the current tree as adapted from Readest. No code changes were made for this document. Paths are relative to the repository root `c:\Users\Eddy\Documents\citadel-app\` unless noted.

**Primary product surface:** The shipping app is **`apps/readest-app`** (Next.js frontend + Tauri shell). Other folders under `apps/` are auxiliary.

---

## 1. Monorepo structure and what each app/package does

### pnpm workspace (`pnpm-workspace.yaml`)

- **`apps/*`** — Application packages.
- **`packages/foliate-js`** — Workspace-linked fork of the Foliate rendering stack (EPUB/PDF/etc.), consumed as `foliate-js` from the app.

### Root Node workspace (`package.json`)

- Name: `@readest/monorepo`.
- Scripts delegate to **`apps/readest-app`** (`pnpm --filter @readest/readest-app …`).

### Applications

| Path                     | Role                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/readest-app/`      | **Main Citadel/Readest app:** Next.js 16 UI, business logic, Tauri `src-tauri`, Cloudflare/OpenNext web build scripts, tests, docs under `apps/readest-app/docs/`. |
| `apps/readest.koplugin/` | **KOReader sync sidecar:** e.g. `apps/readest.koplugin/readest-sync-api.json` — not the desktop/web reader UI.                                                     |

### Packages (selected)

| Path                                        | Role                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/foliate-js/`                      | E-book **rendering engine** (custom elements, EPUB/PDF/MOBI parsers, OPDS, TTS helpers). Built/published as a local workspace dependency (`package.json` → `"foliate-js": "workspace:*"` in the app). |
| `packages/tauri/`                           | **Vendored Tauri 2** sources; root **`Cargo.toml`** `[patch.crates-io]` points `tauri` here for the Readest binary.                                                                                   |
| `packages/tauri-plugins/plugins/fs/`        | **Vendored/patched** `tauri-plugin-fs` (same root `Cargo.toml` patch).                                                                                                                                |
| `packages/simplecc-wasm/`, `packages/qcms/` | Supporting/native-adjacent packages (simplecc copied into app `public/vendor` via scripts; qcms excluded from Cargo workspace but present).                                                           |

**Note:** Many `packages/tauri*` paths are **upstream-style trees** and are **not** all listed in `pnpm-workspace.yaml`. Treat them as Rust/npm sources for patches and tooling, not as separate deployable Node apps unless you wire them in explicitly.

### Rust workspace (`Cargo.toml` at repo root)

Members include:

- `apps/readest-app/src-tauri`
- `packages/tauri/crates/tauri`
- `packages/tauri-plugins/plugins/fs`

---

## 2. Desktop Tauri app entry points

| File                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src-tauri/src/main.rs`     | Binary entry: calls `readestlib::run()` only.                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/readest-app/src-tauri/src/lib.rs`      | **`run()`** — Tauri builder: registers plugins (log, fs, persisted-scope, shell, http, os, dialog, turso, native-bridge, **native-tts**, deep-link, updater, window-state, single-instance on desktop, etc.), **`setup`** hook: FS/asset scope allowances, **`WebviewWindowBuilder::new(..., "main", ...)`** — the primary window, init script for platform flags (`__READEST_*`), macOS window-close behavior, **`window-ready`** emit. |
| `apps/readest-app/src-tauri/tauri.conf.json` | Product id, **`devUrl`**: `http://localhost:3000`, **`frontendDist`**: `../out`, `beforeDevCommand` / `beforeBuildCommand`, **CSP** and **asset protocol** scopes, bundle targets.                                                                                                                                                                                                                                                       |
| `apps/readest-app/src-tauri/Cargo.toml`      | Crate name, features, dependency on local plugins under `apps/readest-app/src-tauri/plugins/` (e.g. `tauri-plugin-native-tts`, `tauri-plugin-turso`, `tauri-plugin-native-bridge`).                                                                                                                                                                                                                                                      |

Platform-specific Rust modules under `apps/readest-app/src-tauri/src/` include `windows/`, `macos/`, `android/`, plus `dir_scanner`, `transfer_file`, `discord_rpc` (desktop).

---

## 3. Next.js app/router structure

### App Router (`apps/readest-app/src/app/`)

| Path                                        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/app/layout.tsx`       | Root layout: metadata, `EnvProvider`, `Providers`, global CSS.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/readest-app/src/app/page.tsx`         | Home: renders **`library/page`** (client library as landing).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/readest-app/src/app/library/page.tsx` | Library UI, import flows, sync hooks, settings touches.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/readest-app/src/app/reader/page.tsx`  | **Tauri-oriented reader route** (comment: app router for Tauri); mounts **`Reader`** without URL ids (uses query / internal state).                                                                                                                                                                                                                                                                                                                               |
| `apps/readest-app/src/app/auth/*`           | Auth pages (login, callback, recovery, update, error).                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/readest-app/src/app/user/*`           | Account/subscription UI.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/readest-app/src/app/opds/page.tsx`    | OPDS client (uses `foliate-js/opds.js`).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/readest-app/src/app/offline/page.tsx` | Offline shell.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/readest-app/src/app/updater/page.tsx` | Updater UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/readest-app/src/app/api/**/route.ts`  | App Router **API routes** (Stripe, AI chat/embed, TTS edge proxy, OPDS proxy, metadata, IAP verify, Hardcover GraphQL). Exact files: `apps/readest-app/src/app/api/ai/chat/route.ts`, `.../embed/route.ts`, `.../apple/iap-verify/route.ts`, `.../google/iap-verify/route.ts`, `.../hardcover/graphql/route.ts`, `.../metadata/search/route.ts`, `.../opds/proxy/route.ts`, `.../stripe/{plans,webhook,check,checkout,portal}/route.ts`, `.../tts/edge/route.ts`. |

### Pages Router (legacy / web-specific)

| Path                                          | Purpose                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/pages/_app.tsx`         | Pages Router wrapper with `EnvProvider` + `Providers`.                                                        |
| `apps/readest-app/src/pages/reader/[ids].tsx` | Reader for **web path** `/reader/:ids` — wraps **`@/app/reader/components/Reader`** with auth/sync providers. |
| `apps/readest-app/src/pages/api/*.ts`         | Legacy APIs: storage (R2/S3-style), sync, kosync, deepl translate, user delete.                               |

### Navigation and build mode

| File                                | Purpose                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/readest-app/next.config.mjs`  | When **`NEXT_PUBLIC_APP_PLATFORM` ≠ `web`** and not dev: **`output: 'export'`** (static export for Tauri **`out/`**). **`rewrites`**: `/reader/:ids` → `/reader?ids=:ids`. Transpiles `foliate-js`, Tauri packages, etc. |
| `apps/readest-app/src/utils/nav.ts` | **`navigateToReader`**: web + non-PWA uses **`/reader/${ids}``**; Tauri/PWA uses **`/reader?ids=...`**. **`showReaderWindow` / `showLibraryWindow`**: extra Tauri **`WebviewWindow`** instances.                         |

---

## 4. Reader UI entry points

| Layer                   | Path                                                           | Role                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell                   | `apps/readest-app/src/app/reader/components/Reader.tsx`        | Waits for **`useLibrary`** (`libraryLoaded`) and **`settings.globalReadSettings`**; theme, transfer queue, toasts; documents **z-index** stacking (TTS bar vs sidebar vs dialogs). Renders **`ReaderContent`**.                      |
| Layout / state          | `apps/readest-app/src/app/reader/components/ReaderContent.tsx` | Parses **book ids** from props, **`useSearchParams`**, or pathname; **`useReaderStore`** `initViewState` / `setBookKeys`; sidebar, notebook, **`BooksGrid`**, **`SettingsDialog`**; library navigation and Tauri window close hooks. |
| Grid of panes           | `apps/readest-app/src/app/reader/components/BooksGrid.tsx`     | Hosts per-book **`FoliateViewer`** (and related chrome).                                                                                                                                                                             |
| Core web component host | `apps/readest-app/src/app/reader/components/FoliateViewer.tsx` | Creates **`<foliate-view>`**, **`view.open(bookDoc)`**, wires styles, progress, transforms, **`useFoliateEvents`**.                                                                                                                  |
| Foliate event adapter   | `apps/readest-app/src/app/reader/hooks/useFoliateEvents.ts`    | Subscribes to view/renderer events.                                                                                                                                                                                                  |
| Book lifecycle          | `apps/readest-app/src/app/reader/hooks/useBooksManager.ts`     | Append/dismiss books, sync URL via **`navigateToReader`**.                                                                                                                                                                           |

Supporting UI clusters live under `apps/readest-app/src/app/reader/components/` (`sidebar/`, `notebook/`, `footerbar/`, `annotator/`, `tts/`, `rsvp/`, etc.) and shared components under `apps/readest-app/src/components/`.

---

## 5. EPUB/PDF rendering pipeline

### Document ingestion (file → structured book)

| File                                        | Role                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/libs/document.ts`     | **`DocumentLoader`**: sniffs ZIP/PDF/MOBI/FB2/CBZ; dynamically imports **`foliate-js`** modules (`epub.js`, `pdf.js`, `mobi.js`, `fb2.js`, `comic-book.js`) and returns **`{ book: BookDoc, format }`**.                  |
| `apps/readest-app/src/store/readerStore.ts` | **`initViewState`**: **`appService.loadBookContent(book)`** → **`new DocumentLoader(file).open()`** → optional nav cache (`computeBookNav` / `hydrateBookNav` for EPUB), TOC update, stores data via **`bookDataStore`**. |

### On-screen rendering

| File                                                           | Role                                                                                                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/foliate-js/*.js`                                     | Low-level parsers, paginator, PDF worker integration (app copies **`pdfjs`** assets into `apps/readest-app/public/vendor/pdfjs` via **`package.json`** scripts `copy-pdfjs*`, `setup-pdfjs`). |
| `apps/readest-app/src/app/reader/components/FoliateViewer.tsx` | **`import('foliate-js/view.js')`**, **`wrappedFoliateView`**, **`await view.open(bookDoc)`**, **`view.init` / `goToFraction`**, renderer attributes (columns, margins, FXL spread/zoom).      |
| `apps/readest-app/src/types/view.ts`                           | Type surface + **`wrappedFoliateView`** helper for the custom element.                                                                                                                        |

### Progress / location

| File                                                                                 | Role                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `apps/readest-app/src/utils/cfi.ts`, `apps/readest-app/src/utils/xcfi.ts`            | CFI helpers using **`foliate-js/epubcfi.js`**. |
| `apps/readest-app/src/app/reader/hooks/useProgressAutoSave.ts`, `useProgressSync.ts` | Persist and sync reading position.             |

---

## 6. Book import and library storage

### In-memory / UI state

| File                                         | Role                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/store/libraryStore.ts` | **`library`**, **`visibleLibrary`**, hash index, **`updateBook` / `updateBooks`**, calls **`appService.saveLibraryBooks`**. |
| `apps/readest-app/src/hooks/useLibrary.ts`   | On mount: **`appService.loadSettings()`**, **`appService.loadLibraryBooks()`** into stores.                                 |

### Persistence contracts

| File                                              | Role                                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/services/libraryService.ts` | **`loadLibraryBooks` / `saveLibraryBooks`**: JSON file **`library.json`** under base dir **`Books`** (via **`getLibraryFilename()`** in `apps/readest-app/src/utils/book.ts`), **`safeLoadJSON` / `safeSaveJSON`**. |
| `apps/readest-app/src/utils/book.ts`              | Per-book paths: **`{hash}/`** tree, **`config.json`**, **`nav.json`**, **`cover.png`**, local filename pattern **`getLocalBookFilename`**.                                                                          |
| `apps/readest-app/src/services/persistence.ts`    | Atomic-ish JSON writes (`.bak` then main).                                                                                                                                                                          |

### Platform implementations

| File                                                | Role                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/services/environment.ts`      | **`getAppService()`** → **`NativeAppService`** if **`NEXT_PUBLIC_APP_PLATFORM === 'tauri'`**, else **`WebAppService`**. |
| `apps/readest-app/src/services/nativeAppService.ts` | Tauri **FS**, dialogs, path resolver (custom root / portable mode), **`loadBookContent`**, covers, configs, DB, etc.    |
| `apps/readest-app/src/services/webAppService.ts`    | Browser storage + remote APIs (`pages/api`, Supabase, etc.).                                                            |
| `apps/readest-app/src/services/appService.ts`       | Shared **`BaseAppService`** orchestration used by native/web.                                                           |

### Import UI entry points

| Path                                                          | Role                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/readest-app/src/app/library/components/ImportMenu.tsx`  | Menu: local file, directory (if provided), OPDS / online catalogs.                                 |
| `apps/readest-app/src/app/library/hooks/useDragDropImport.ts` | Drag/drop onto library page.                                                                       |
| `apps/readest-app/src/app/library/page.tsx`                   | Large coordinator: deep links, file query params, merge with **`OPEN_WITH_FILES`**, saves library. |

---

## 7. TTS / read-aloud logic

| Path                                                                        | Role                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `apps/readest-app/src/services/tts/TTSController.ts`                        | Core controller: **`foliate-js/tts.js`**, **`foliate-js/text-walker.js`**, **`foliate-js/overlayer.js`** for highlights; switches **`WebSpeechClient`**, **`EdgeTTSClient`**, **`NativeTTSClient`** (Android). |
| `apps/readest-app/src/services/tts/WebSpeechClient.ts`                      | Browser speech synthesis.                                                                                                                                                                                      |
| `apps/readest-app/src/services/tts/EdgeTTSClient.ts`                        | Edge voices (uses app service / network).                                                                                                                                                                      |
| `apps/readest-app/src/services/tts/NativeTTSClient.ts`                      | Android native pipeline.                                                                                                                                                                                       |
| `apps/readest-app/src/app/reader/hooks/useTTSControl.ts`                    | React hook: constructs **`TTSController`**, wires events, coordinates with view.                                                                                                                               |
| `apps/readest-app/src/app/reader/hooks/useTTSMediaSession.ts`               | Lock screen / OS media integration; uses **`apps/readest-app/src/libs/mediaSession.ts`** (`TauriMediaSession` vs browser **`MediaSession`**).                                                                  |
| `apps/readest-app/src/app/reader/components/tts/TTSBar.tsx`, `TTSPanel.tsx` | UI controls.                                                                                                                                                                                                   |
| `apps/readest-app/src/app/api/tts/edge/route.ts`                            | Server-side Edge TTS proxy for web builds.                                                                                                                                                                     |
| `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/`               | Rust plugin bridged to JS (`plugin:native-tts                                                                                                                                                                  | …`invocations in`mediaSession.ts`). |

---

## 8. Settings / theme / state persistence

| Concern                         | Paths                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System settings schema & IO** | `apps/readest-app/src/services/settingsService.ts` ( **`loadSettings` / `saveSettings`**, migrations, defaults from `apps/readest-app/src/services/constants.ts`), persisted via **`FileSystem`** under **`Settings`** base (see `SETTINGS_FILENAME` in constants). |
| **Zustand: settings**           | `apps/readest-app/src/store/settingsStore.ts` — **`saveSettings`** → **`appService.saveSettings`**.                                                                                                                                                                 |
| **Zustand: theme**              | `apps/readest-app/src/store/themeStore.ts` — reads **`localStorage`** keys **`themeMode`**, **`themeColor`**; **`saveCustomTheme`** can persist via **`appService.saveSettings`**.                                                                                  |
| **Reader / layout stores**      | `apps/readest-app/src/store/readerStore.ts`, `sidebarStore.ts`, `notebookStore.ts`, `parallelViewStore.ts`, `bookDataStore.ts`, etc.                                                                                                                                |
| **Global providers**            | `apps/readest-app/src/components/Providers.tsx` (also loads settings early), `apps/readest-app/src/context/EnvContext.tsx`.                                                                                                                                         |

---

## 9. Where a future audiobook player should integrate safely

**Prefer boundary layers over the Foliate custom element internals.**

1. **New service module (parallel to TTS)**
   - Add e.g. `apps/readest-app/src/services/audiobook/` (controller + platform clients) mirroring **`apps/readest-app/src/services/tts/`**, without changing **`FoliateViewer.tsx`** until playback needs document coupling.

2. **UI placement**
   - **`Reader.tsx`** documents stacking: TTS lives at z-index **30–40**. Reuse that band or add a dedicated layer with a new z-index comment block to avoid fighting **`SettingsDialog`** / sidebars.
   - **`apps/readest-app/src/app/reader/components/tts/`** is a natural **UX reference**; a separate **`audiobook/`** folder avoids entangling with **`useTTSControl.ts`**.

3. **OS / background playback**
   - Extend **`apps/readest-app/src/libs/mediaSession.ts`** and **`useTTSMediaSession.ts`** patterns (or sibling hook) so lock-screen controls stay consistent with native TTS expectations.

4. **Library / book model**
   - **`apps/readest-app/src/types/book.ts`** — extend **`Book` / `BookFormat`** or add sidecar metadata **after** defining storage rules in **`nativeAppService` / `webAppService`** for where audio files live (mirror **`getLocalBookFilename`** patterns in `apps/readest-app/src/utils/book.ts`).

5. **Routing**
   - Optional dedicated route under **`apps/readest-app/src/app/`** if audiobooks need a non-reader shell; otherwise embed in **`ReaderContent`** next to **`BooksGrid`**.

---

## 10. Where future text/audio sync and highlighting should integrate safely

1. **Existing pattern: TTS highlights**
   - **`TTSController`** (`apps/readest-app/src/services/tts/TTSController.ts`) already drives **`foliate-js/overlayer.js`** and section index guards — **extend or fork the controller pattern** rather than poking **`foliate-view`** shadow DOM ad hoc.

2. **Progress and CFIs**
   - **`useReaderStore.setProgress`** and **`useProgressAutoSave`** — authoritative reading location for UI and sync.
   - **`apps/readest-app/src/utils/cfi.ts`** / **`xcfi.ts`** — align any external sync format with stored CFIs.

3. **Annotations**
   - **`apps/readest-app/src/app/reader/components/annotator/`** and **`apps/readest-app/src/services/annotation/`** — for user-visible highlights tied to CFIs; keep audiobook “sync highlights” either mapped into **`BookNote`** or a parallel structure merged in **`bookDataStore`** / **`saveBookConfig`**.

4. **Foliate events**
   - **`useFoliateEvents`** (`apps/readest-app/src/app/reader/hooks/useFoliateEvents.ts`) — subscribe to **`relocate`** / load events to drive external audio position **from** the renderer.

5. **Package boundary**
   - If sync requires new anchors inside the package, prefer **`packages/foliate-js`** extensions with clear APIs **rather than** scattering DOM queries across `FoliateViewer`.

---

## 11. Risky / core files to avoid changing early

Touching these without strong tests tends to break **builds, security, storage, or all reading**:

| Area                     | Paths                                                                                                                                                                                                                 | Why risky                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tauri lifecycle & window | `apps/readest-app/src-tauri/src/lib.rs`, `main.rs`, `tauri.conf.json`, `capabilities/*.json`                                                                                                                          | Window id **`main`**, CSP, asset scopes, single-instance, OAuth, file open behavior. |
| Path / FS abstraction    | `apps/readest-app/src/services/nativeAppService.ts`, `apps/readest-app/src/types/system.ts`                                                                                                                           | Portable/custom root, **`FileSystem`** contract, all book paths.                     |
| Book open pipeline       | `apps/readest-app/src/store/readerStore.ts` (**`initViewState`**), `apps/readest-app/src/app/reader/components/FoliateViewer.tsx`                                                                                     | Ordering: load content → open document → nav cache → TOC → view.open.                |
| Document formats         | `apps/readest-app/src/libs/document.ts`, `packages/foliate-js/**`                                                                                                                                                     | Format detection and upstream behavior; PDF worker wiring.                           |
| Next export / bundling   | `apps/readest-app/next.config.mjs`                                                                                                                                                                                    | **`output: 'export'`** for Tauri, rewrites, transpile list, aliases for WASM stubs.  |
| Persistence & migrations | `apps/readest-app/src/services/persistence.ts`, `apps/readest-app/src/services/settingsService.ts`, `apps/readest-app/src/services/database/migrate.ts`, `apps/readest-app/src/services/database/migrations/index.ts` | Data loss / corruption risk.                                                         |
| Rust workspace patches   | `Cargo.toml` (root), `apps/readest-app/src-tauri/Cargo.toml`                                                                                                                                                          | Patched **`tauri`** / **`tauri-plugin-fs`** versions.                                |
| Core types               | `apps/readest-app/src/types/book.ts`, `apps/readest-app/src/types/view.ts`                                                                                                                                            | Ripple through stores, sync, and Foliate adapter.                                    |

---

## 12. Citadel design handoff — brand raster paths (TASK-001 / CT-002)

Next.js serves files under **`apps/readest-app/public/`** at the site root (same paths in Tauri static export). The **intended** location for Citadel logo/comet rasters (separate from existing icons such as `/icon.png`) is:

| Role                  | Path on disk (repo root relative)                  | URL path (once files exist) |
| --------------------- | -------------------------------------------------- | --------------------------- |
| Citadel logo mark     | `apps/readest-app/public/citadel/citadel-logo.png` | `/citadel/citadel-logo.png` |
| Comet / splash accent | `apps/readest-app/public/citadel/comet.png`        | `/citadel/comet.png`        |

**Handoff inventory:** Intended usage and display sizes are described in `Agents/handoff/asset-list.md` (paths there are written relative to an older “project” layout; the Readest fork targets the table above).

**Status:** These raster files are **not present in the repo** yet; the `public/citadel/` tree is **pending** until real design-export PNGs are copied from outside the repo (or added to handoff and then copied). No placeholder assets should be committed there.

---

## Quick reference: highest-traffic paths for Citadel work

- **Rename / brand / env:** `apps/readest-app/src/app/layout.tsx`, `apps/readest-app/src/services/constants.ts`, `apps/readest-app/src-tauri/tauri.conf.json`, `package.json` / `apps/readest-app/package.json`.
- **New reader feature (UI):** `apps/readest-app/src/app/reader/components/` + `apps/readest-app/src/store/readerStore.ts`.
- **New persistent data:** extend **`AppService`** in `apps/readest-app/src/types/system.ts` + native/web implementations + optional DB migration under `apps/readest-app/src/services/database/`.
- **New network API (web):** `apps/readest-app/src/app/api/.../route.ts`.

---

_Generated for Citadel planning; filenames reflect the current Readest-oriented tree._
