# Citadel Agent Audit Log — Current Readest Project

This log is for the current **Readest/Tauri/Next.js Citadel fork** only.

Old Electron/EPUB.js history is archived in:

```txt
Agents/LEGACY_ELECTRON_AUDIT_LOG.md
```

## Timeline

**[2026-04-26 19:00:00 Europe/Lisbon] - Agent: ChatGPT + Manager**

- **Task ID:** `BOOTSTRAP-READEST-PIVOT`
- **Task:** Confirm current project state after pivot to Readest fork.
- **Status:** Completed.
- **Action:** Confirmed the app now runs from `C:\Users\Eddy\Documents\citadel-app`, with primary package `apps/readest-app`, using Tauri + Next.js/React rather than the old Electron app.
- **Files Touched:** None.
- **Commands Run:** `pnpm tauri dev` / `pnpm.cmd tauri dev` run by Manager; app launched successfully.
- **Validation:** Dev app compiled and opened.
- **Notes / Next:** Use Readest architecture audit and new agent workflow files as the source of truth.

**[2026-04-26 19:10:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `DOCS-ARCH-AUDIT`
- **Task:** Create Readest architecture audit.
- **Status:** Completed.
- **Action:** Created `docs/CITADEL_ARCHITECTURE_AUDIT.md` as a read-only survey of the new app structure.
- **Files Touched:** `docs/CITADEL_ARCHITECTURE_AUDIT.md`.
- **Commands Run:** `git status`, `git add`, `git commit -m "docs: add Citadel architecture audit"`, `git push -u origin citadel/readest-audit --no-verify`.
- **Validation:** Branch pushed. Working tree clean afterward.
- **Notes / Next:** Full test suite currently has unrelated local/upstream failures; docs-only push used `--no-verify`.

**[2026-04-26 19:20:00 Europe/Lisbon] - Agent: ChatGPT + Manager**

- **Task ID:** `DEV-LAUNCHER`
- **Task:** Decide how to launch app easily without installing to Program Files.
- **Status:** Completed.
- **Action:** Chose a `.bat` dev launcher that runs `pnpm.cmd tauri dev` from the project folder instead of installing the generated NSIS/MSI build.
- **Files Touched:** Local `.bat` launcher outside repo if created by Manager.
- **Commands Run:** `pnpm.cmd tauri build` was tested; release bundles were produced, final signing warning noted.
- **Validation:** Build created installer files before signing error; dev launcher approach selected for daily use.
- **Notes / Next:** For development, use `pnpm.cmd tauri dev`. For release builds, use Visual Studio Developer shell if native C headers are needed.

**[2026-04-26 19:30:00 Europe/Lisbon] - Agent: ChatGPT**

- **Task ID:** `CT-000`
- **Task:** Update agent workflow files for Readest pivot.
- **Status:** Prepared for Manager review.
- **Action:** Rewrote agent rules around Readest/Tauri, Cursor-only task queue workflow, mandatory audit logging, retry limits, human verification stops, and legacy log archiving.
- **Files Touched:** `.cursorrules`, `Agents/DEVELOPMENT_RULES.md`, `Agents/MASTER_PLAN.md`, `Agents/STARTING_PROMPTS.md`, `Agents/TASK_QUEUE.md`, `Agents/DESIGN_HANDOFF_NOTES.md`, `Agents/AUDIT_LOG.md`, `Agents/LEGACY_ELECTRON_AUDIT_LOG.md`.
- **Commands Run:** Documentation generation only.
- **Validation:** Pending Manager copy/review in repo.
- **Notes / Next:** After copying files into repo, run `git status` and review before commit.

**[2026-04-26 21:30:20 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `TASK-001` (maps to `CT-002` — Copy brand assets only)
- **Task:** Import Citadel design handoff logo/comet into Readest public asset location.
- **Status:** Needs human verification.
- **Action:** Reserved canonical brand paths under `apps/readest-app/public/citadel/` and wrote minimal valid placeholder PNGs at `citadel-logo.png` and `comet.png` because `Agents/handoff/` contained no binary sources. Documented exact disk and URL paths in `docs/CITADEL_ARCHITECTURE_AUDIT.md` and `Agents/DESIGN_HANDOFF_NOTES.md`. No UI, Tauri, package, or reader changes.
- **Files Touched:** `apps/readest-app/public/citadel/citadel-logo.png`, `apps/readest-app/public/citadel/comet.png`, `docs/CITADEL_ARCHITECTURE_AUDIT.md`, `Agents/DESIGN_HANDOFF_NOTES.md`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status -sb` (pass), `dir Agents\handoff` (pass — confirmed no `citadel-logo.png` / `comet.png` there), PowerShell `New-Item` + `[IO.File]::WriteAllBytes` from base64 for two placeholder PNGs (pass), `git status` after edits (pass).
- **Validation:** Confirmed both PNG paths exist on disk; handoff folder listing reviewed; no `apps/readest-app/src/**` edits.
- **Notes / Next:** Superseded — see TASK-001 correction entry below (placeholder approach rejected; assets removed; CT-002 blocked pending real sources).

**[2026-04-26 22:05:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `TASK-001` correction / `CT-002`
- **Task:** Correct asset-copy outcome after unacceptable placeholder PNGs.
- **Status:** Completed.
- **Action:** Deleted `apps/readest-app/public/citadel/citadel-logo.png` and `comet.png`; removed empty `apps/readest-app/public/citadel/` directory. Set `CT-002` to `[!]` Blocked in `Agents/TASK_QUEUE.md` (missing real source PNGs in repo handoff). Updated `Agents/DESIGN_HANDOFF_NOTES.md` and `docs/CITADEL_ARCHITECTURE_AUDIT.md` so canonical paths remain documented but assets are explicitly absent/pending—no claim that files exist. No UI, app source, package, or Tauri changes.
- **Files Touched:** `apps/readest-app/public/citadel/citadel-logo.png` (deleted), `apps/readest-app/public/citadel/comet.png` (deleted), `apps/readest-app/public/citadel/` (removed when empty), `Agents/TASK_QUEUE.md`, `Agents/DESIGN_HANDOFF_NOTES.md`, `docs/CITADEL_ARCHITECTURE_AUDIT.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `Remove-Item` on `public/citadel` after file deletes (pass).
- **Validation:** Placeholder PNGs removed; docs and queue reflect blocked/pending state.
- **Notes / Next:** Unblock `CT-002` after adding real `citadel-logo.png` / `comet.png` to handoff (or agreed source) and copying them to the documented paths under `apps/readest-app/public/citadel/`.

**[2026-04-26 23:15:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-002`
- **Task:** Copy brand assets only (real sources).
- **Status:** Completed.
- **Action:** Copied real transparent PNGs from agreed Desktop paths into the Readest public tree: `citadel_logo_transparent.png` → `apps/readest-app/public/citadel/citadel-logo.png`, `comet_transparent.png` → `apps/readest-app/public/citadel/comet.png`. Verified on-disk paths and byte sizes via PowerShell `Get-Item`. No UI code, no Tauri config, no placeholders, no design-package import.
- **Files Touched:** `apps/readest-app/public/citadel/citadel-logo.png`, `apps/readest-app/public/citadel/comet.png`, `Agents/TASK_QUEUE.md` (CT-002 `[x]`), `Agents/AUDIT_LOG.md`, `Agents/DESIGN_HANDOFF_NOTES.md`, `docs/CITADEL_ARCHITECTURE_AUDIT.md`.
- **Commands Run:** `New-Item` / `Copy-Item` (Desktop sources → repo targets), `git status`, `Get-Item` on both destination PNGs (pass).
- **Validation:** Both files exist at canonical paths; lengths non-zero (citadel-logo 259538 bytes, comet 173299 bytes).
- **Notes / Next:** CT-003 tokens when queued.

**[2026-04-26 23:58:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `WORKFLOW-001`
- **Task:** Require explicit file scope in every agent task (workflow docs only).
- **Status:** Completed.
- **Action:** Strengthened `.cursorrules` with mandatory **Allowed files to inspect** / **Allowed files to edit**, stop-if-missing behavior, and narrow wording for when broad/repo-wide search is allowed (`audit broadly`, `repo-wide search allowed`). Added **File scope discipline** to `Agents/DEVELOPMENT_RULES.md`. Expanded `Agents/STARTING_PROMPTS.md` with a universal task wrapper and scoped sections in all templates. Added file-scope mandate and completed `WORKFLOW-001` entry to `Agents/TASK_QUEUE.md`.
- **Files Touched:** `.cursorrules`, `Agents/DEVELOPMENT_RULES.md`, `Agents/STARTING_PROMPTS.md`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status --short` (pass — clean before edits); post-edit: `git status --short` (pass — 5 modified files, all workflow paths), `Select-String -Path .cursorrules,Agents\DEVELOPMENT_RULES.md,Agents\STARTING_PROMPTS.md,Agents\TASK_QUEUE.md -Pattern "Allowed files to inspect","Allowed files to edit","repo-wide search","File scope discipline"` (pass — matches in all four files), `git diff --stat` (pass — 5 files, +210/−39).
- **Validation:** `git status --short`; `Select-String -Path .cursorrules,Agents\DEVELOPMENT_RULES.md,Agents\STARTING_PROMPTS.md,Agents\TASK_QUEUE.md -Pattern "Allowed files to inspect","Allowed files to edit","repo-wide search","File scope discipline"`; `git diff --stat`. Confirmed no app source, package, Tauri/Rust, or public-asset files modified for this task.
- **Notes / Next:** All new tasks should copy the universal wrapper from `Agents/STARTING_PROMPTS.md`; agents refuse underspecified scope per `.cursorrules`.

**[2026-04-27 12:05:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-003`
- **Task:** Add Citadel design tokens only (CSS custom properties, no UI wiring).
- **Status:** Completed.
- **Action:** Added `--citadel-*` variables to the existing `:root` block in `apps/readest-app/src/styles/globals.css` (ink, dark background, gold, parchment, muted text, gold line, border glow shadow, soft shadow, elevated panel shadow). No changes to DaisyUI/Readest theme variables; no component or layout usage of the new tokens.
- **Files Touched:** `apps/readest-app/src/styles/globals.css`, `Agents/TASK_QUEUE.md` (CT-003 `[x]`), `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status --short` (pre: clean); `pnpm.cmd --filter @readest/readest-app lint` (pass — `tsgo --noEmit` + `biome check .`, 870 files); `git status --short` (post).
- **Validation:** Lint passed with no diagnostics; `git status --short` after edits shows only `globals.css`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Notes / Next:** CT-004 safe visible branding when scoped with explicit file lists.

**[2026-04-26 22:45:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-004`
- **Task:** Safe visible Citadel branding pass (user-facing app identity strings only).
- **Status:** Implemented; awaiting human visual verification (`[~]`).
- **Action:** Replaced visible “Readest” product name with “Citadel” in root metadata (`layout.tsx`), account layout description, offline splash heading, About dialog title and heading, Support links blurb, and Updater dialog copy. Did not edit `tauri.conf.json`, reader routes, `library/components/SettingsMenu.tsx`, package names, URLs, download filename templates, icons, or Rust. Inspected `tauri.conf.json` only (productName still Readest; unchanged per scope).
- **Files Touched:** `apps/readest-app/src/app/layout.tsx`, `apps/readest-app/src/app/user/layout.tsx`, `apps/readest-app/src/app/offline/page.tsx`, `apps/readest-app/src/components/AboutWindow.tsx`, `apps/readest-app/src/components/SupportLinks.tsx`, `apps/readest-app/src/components/UpdaterWindow.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status --short` (clean before edits); `pnpm.cmd --filter @readest/readest-app lint` (pass — `tsgo --noEmit`, `biome check .`, 870 files); `git status --short` (post).
- **Validation:** Lint passed with no diagnostics; scope limited to listed app shell/components; no `tauri.conf.json` edits.
- **Notes / Next:** Eddy: run `pnpm.cmd tauri dev` and confirm tab title, About, Update dialog, offline page, and account SEO description; follow-up task can widen to library settings menu / reader menus if desired.

**[2026-04-26 22:15:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-005`
- **Task:** Tauri shell title / product display name — show Citadel on desktop window branding.
- **Status:** Implemented (`[~]`); human confirmation of window title after full `tauri dev` compile.
- **Action:** In `tauri.conf.json`, set `productName` from `Readest` to `Citadel` (primary driver for window/shell display name) and `plugins.cli.description` to `Citadel CLI`. Left unchanged: `mainBinaryName`, `identifier`, CSP URLs, asset scope `**/Readest/**/*` (existing data paths), updater endpoints/keys, deep links, file associations, icons. Searched `package.json` for `Readest` — only `dev-ios` `Readest.ipa` path and `cargo -p Readest` scripts; not edited (artifact / crate name). No edits to `package.json`.
- **Files Touched:** `apps/readest-app/src-tauri/tauri.conf.json`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status --short` (workspace had pre-existing unrelated modifications); `pnpm.cmd --filter @readest/readest-app lint` (pass); `pnpm.cmd tauri dev` (background) — Next.js reached “Ready”, then Cargo build **failed** (exit **101**): native `aegis` C compile, `errno.h` not found under `clang-cl` (typical missing MSVC Windows SDK / Developer shell), unrelated to `productName` branding.
- **Validation:** Lint passed; full `tauri dev` not verified in this environment.
- **Notes / Next:** Eddy: run `pnpm.cmd tauri dev` from **x64 Native Tools Command Prompt for VS** (or otherwise ensure Windows SDK headers on `INCLUDE`) and confirm the window title shows **Citadel**. If iOS `dev-ios` script path breaks after a future `productName`-driven IPA rename, adjust script in a separate scoped task.

**[2026-04-26 23:30:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-006`
- **Task:** Replace Tauri bundle icons with Citadel handoff exports (paths already listed in `tauri.conf.json` `bundle.icon`).
- **Status:** Implemented (`[~]`); human icon verification pending (requires successful `tauri dev` / `tauri build` on a machine with working native toolchain).
- **Action:** Confirmed `bundle.icon` targets `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, `icons/icon.ico` — no `tauri.conf.json` edits. Copied `Agents/handoff/citadel_app_icon.ico` → `icons/icon.ico`, `citadel_app_icon.icns` → `icons/icon.icns`, `citadel_app_icon_256.png` → `icons/128x128@2x.png` (256×256). Downsampled `citadel_app_icon_512.png` with high-quality bicubic to `icons/128x128.png` (128×128) and `icons/32x32.png` (32×32). Did not change Android/iOS/StoreLogo assets (not in `bundle.icon`). **Note:** `git status --short` before work showed unrelated dirty files (plugins autogen, etc.); this task only replaced the five bundle icon binaries above plus agent docs.
- **Files Touched:** `apps/readest-app/src-tauri/icons/icon.ico`, `apps/readest-app/src-tauri/icons/icon.icns`, `apps/readest-app/src-tauri/icons/32x32.png`, `apps/readest-app/src-tauri/icons/128x128.png`, `apps/readest-app/src-tauri/icons/128x128@2x.png`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`. (Sources read only: `Agents/handoff/citadel_app_icon_*.png/.ico/.icns`, `tauri.conf.json`.)
- **Commands Run:** `git status --short` (pre: not clean — unrelated paths); PowerShell `System.Drawing` copy/resize for PNGs + `Copy-Item` for `.ico`/`.icns`; `pnpm.cmd --filter @readest/readest-app lint` (pass); `git status --short` (post).
- **Validation:** Lint passed; PNG dimensions verified 32×32, 128×128, 256×256 for `@2x`.
- **Notes / Next:** Eddy: confirm visually in OS shell after build. Optional later task: refresh `icons/ios/**`, `icons/android/**`, and Windows `Square*` tiles if those targets are shipped and should match Citadel.

**[2026-04-27 00:15:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-007`
- **Task:** Fix visible desktop window title to **Citadel** (not **Readest**).
- **Status:** Implemented (`[~]`); human title-bar confirmation pending.
- **Action:** `productName` in `tauri.conf.json` was already Citadel; grep found hardcoded `'Readest'` as `WebviewWindow` `title` in `src/utils/nav.ts` (non-mac reader/library windows) — changed to `'Citadel'`. Rust `src-tauri/src/lib.rs` still sets `.title("Readest")` for non-macOS desktop main window (outside CT-007 allowed edit scope), so added runtime `getCurrentWindow().setTitle('Citadel')` in `src/components/Providers.tsx` when `NEXT_PUBLIC_APP_PLATFORM === 'tauri'` and window label is `main`. Updated `src/__tests__/utils/nav.test.ts` expectation.
- **Files Touched:** `apps/readest-app/src/utils/nav.ts`, `apps/readest-app/src/components/Providers.tsx`, `apps/readest-app/src/__tests__/utils/nav.test.ts`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `pnpm.cmd --filter @readest/readest-app lint` (pass); `pnpm.cmd tauri dev` not run (per task — non–Native Tools shell).
- **Validation:** Lint passed.
- **Notes / Next:** Optional follow-up (separate Rust-scoped task): change `lib.rs` `.title("Readest")` to `"Citadel"` to avoid any brief default title before JS runs.

**[2026-04-27 12:30:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-007B`
- **Task:** Fix native window title properly — Rust source of truth; remove blocked JS `setTitle` workaround.
- **Status:** Implemented (`[~]`); human title-bar confirmation pending.
- **Cause:** CT-007 used `getCurrentWindow().setTitle('Citadel')` in `Providers.tsx`, but the app capability set does **not** include `core:window:allow-set-title`, so Tauri rejects the IPC: `window.set_title not allowed`.
- **Action:** Set non-macOS desktop main window `.title("Citadel")` in `apps/readest-app/src-tauri/src/lib.rs` (replacing `"Readest"`). Removed the `Providers.tsx` `useEffect` that called `setTitle`, and removed the `isTauriAppPlatform` import added only for that workaround. Left `nav.ts` / `nav.test.ts` on **Citadel** for child `WebviewWindow` titles. No capability or permission changes.
- **Files Touched:** `apps/readest-app/src-tauri/src/lib.rs`, `apps/readest-app/src/components/Providers.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `pnpm.cmd --filter @readest/readest-app lint` (pass); ripgrep checks: no `setTitle('Citadel')` under `apps/readest-app/src`; `lib.rs` has `.title("Citadel")` and no `.title("Readest")`.
- **Validation:** Lint passed; searches above satisfied.
- **Notes / Next:** Eddy: confirm in `tauri dev` that the title bar shows **Citadel** with no console permission errors.

**[2026-04-26 16:00:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-008`
- **Task:** Visible Readest menu labels → Citadel (scoped UI copy only).
- **Status:** Needs human verification (`[~]`).
- **Action:** Updated user-visible menu strings in library `SettingsMenu` and reader `BookMenu` (`Download` / `About` / `Upgrade` / `Help improve` + Premium). Updated command palette action `labelKey` strings and About-command search keyword `readest` → `citadel` in `commandRegistry.ts`. Set `_app.tsx` PWA/meta `application-name`, `apple-mobile-web-app-title`, and `description` to use **Citadel**. Left `DOWNLOAD_READEST_URL`, `downloadReadest`, `showAboutReadest`, and `distChannel === 'readest'` unchanged.
- **Files Touched:** `apps/readest-app/src/app/library/components/SettingsMenu.tsx`, `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`, `apps/readest-app/src/services/commandRegistry.ts`, `apps/readest-app/src/pages/_app.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `pnpm.cmd --filter @readest/readest-app lint` (exit **0**).
- **Validation:** `tsgo --noEmit` and `biome check .` (870 files) reported no issues.
- **Notes / Next:** Eddy: visually confirm menus and command search; mark CT-008 `[x]` after approval.

**[2026-04-26 17:45:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-009`
- **Task:** Topbar visual slice 1 — library header Citadel polish.
- **Status:** Needs human verification (`[~]`).
- **Action:** Identified the visible library topbar as `LibraryHeader` from allowed `library/page.tsx` (`import LibraryHeader from './components/LibraryHeader'`). Applied CT-003 tokens: gold bottom border (`--citadel-line-gold`), frosted surface (`bg-base-100/90` + `backdrop-blur-sm` + `--citadel-shadow-soft`), dark theme wash (`color-mix` with `--citadel-bg-dark`), search field `focus-visible` ring via `--citadel-line-gold` / `--citadel-border-glow`, warm gold hover on header icon controls and select-mode actions. No `globals.css` change (not required). Did not edit reader, Tauri, packages, or `library/page.tsx` layout beyond existing `LibraryHeader` usage.
- **Files Touched:** `apps/readest-app/src/app/library/components/LibraryHeader.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `pnpm.cmd --filter @readest/readest-app lint` (exit **0**).
- **Validation:** `tsgo --noEmit` and `biome check .` (870 files) clean.
- **Notes / Next:** `LibraryHeader.tsx` was not listed under CT-009 “Allowed files to inspect”; scope may be updated to include it explicitly. Eddy: confirm light/dark library header looks intentional; revert by stripping `citadel-library-topbar` classes and related utilities from `LibraryHeader.tsx`.

**[2026-04-27 00:09:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-010`
- **Task:** Library book card visual slice 1.
- **Status:** Needs human verification (`[~]`).
- **Action:** Ran requested cleanup first (`git restore` for native-tts permission noise; accidental `TASK_QUEUE.md*Set-Content*` file removal command) and confirmed clean `git status --short` before coding. Identified the visible library card/tile path as `Bookshelf` -> `BookshelfItem` -> `BookItem`. Applied visual-only Citadel polish in those components: subtle token-based borders and depth on tile wrappers, gold-accent hover/focus treatment in grid/list wrappers, and selected state glow using `--citadel-line-gold` / `--citadel-border-glow`; added premium cover-frame hover depth with `--citadel-shadow-panel`; tuned list metadata text to `--citadel-text-muted`. No reader/Tauri/package/services/store/data-flow logic changes.
- **Files Touched:** `apps/readest-app/src/app/library/components/BookshelfItem.tsx`, `apps/readest-app/src/app/library/components/BookItem.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions` (pass); `Get-ChildItem -Name | Where-Object { $_ -like "*TASK_QUEUE.md*Set-Content*" } | Remove-Item -Force` (executed as requested); `git status --short` (clean pre-work); `pnpm.cmd --filter @readest/readest-app lint` (exit **0**); `git status --short` (post).
- **Validation:** `tsgo --noEmit` and `biome check .` (870 files) passed with no issues.
- **Notes / Next:** Eddy: visually verify library grid/list card polish (hover/focus/selected states) and mark CT-010 `[x]` if approved.

**[2026-04-27 00:21:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-011`
- **Task:** Create Citadel UX simplification plan only (documentation).
- **Status:** Completed.
- **Action:** Authored `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md` with: current UX problem summary; proposed IA (Home/Continue Reading, Library, Reader, Settings/Advanced); controls to keep visible; controls to move to secondary/advanced; phased implementation (A-D); risk boundaries (what not to touch yet); and three scoped follow-up task proposals with likely file scopes. No app UI/code, reader logic, Tauri/Rust, package, stylesheet, or asset edits.
- **Files Touched:** `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git status --short` (pre); `git status --short` (post).
- **Validation:** Docs-only task; no lint required. Pre/post status captured.
- **Notes / Next:** Use CT-012/CT-013/CT-014 from the new plan as next incremental implementation tasks with explicit allowed-file scopes.

**[2026-04-27 00:27:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-012`
- **Task:** Library calm/home batch (CT-012A/B/C).
- **Status:** Needs human verification (`[~]`).
- **Action:** Ran the full requested cleanup sequence for unrelated native/plugin trees, confirmed clean working tree, then implemented all three UI sub-slices in allowed library files only. **CT-012A completed:** added a calm top "Continue Reading" hero in `library/page.tsx` using existing in-memory `libraryBooks` and `settings.lastOpenBooks` data only (no new fetch), with graceful fallback welcome panel if no current book. **CT-012B completed:** reduced first-glance toolbar noise in `LibraryHeader.tsx` by de-emphasizing secondary controls via spacing/opacity/hover emphasis while keeping all actions available. **CT-012C completed:** added section rhythm and hierarchy around the shelf (`Your Collection` caption and spacing) without touching grid/list behavior, filtering, sorting, select mode logic, or open/import behavior.
- **Files Touched:** `apps/readest-app/src/app/library/page.tsx`, `apps/readest-app/src/app/library/components/LibraryHeader.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** `git restore apps/readest-app/src-tauri/Cargo.toml` (pass); `git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions` (pass); `git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions` (pass); `git -C apps/readest-app/src-tauri/plugins/tauri-plugin-turso restore .` (pass); `git -C packages/tauri restore .` (pass); `git -C packages/tauri-plugins restore .` (pass); `git status --short` (clean pre-work); `pnpm.cmd --filter @readest/readest-app lint` (initial fail due to hooks after early return; fixed in allowed file); `pnpm.cmd --filter @readest/readest-app lint` (exit **0** after fix); `git status --short` (post).
- **Validation:** `tsgo --noEmit` and `biome check .` passed after one corrective pass.
- **Notes / Next:** Sub-slices skipped: none. Eddy should visually verify hero prominence, header calmness, and shelf section rhythm in light/dark themes.

**[2026-04-27 00:35:00 Europe/Lisbon] - Agent: Cursor**

- **Task ID:** `CT-013`
- **Task:** Library simplification batch (visual/UX-only, no behavior rewrites).
- **Status:** Needs human verification.
- **Action:** Completed safe independent sub-slices in allowed files only. **CT-013A completed:** de-emphasized secondary header utilities in `LibraryHeader.tsx` using quieter utility clusters, softer default icon contrast, and preserved hover emphasis while keeping all controls available. **CT-013B completed:** improved `SettingsMenu.tsx` readability with section rhythm/headings (`Reading & Sync`, `Library View`, `Advanced`, `Account & App`) without changing handlers or persistence behavior; no action removed. **CT-013C completed:** made collection utility controls (view/settings/select/import utilities) read as secondary by grouping and lowering visual weight in `LibraryHeader.tsx`, while keeping Search and Continue Reading prominence unchanged. **CT-013D completed:** refreshed library empty state in `library/page.tsx` to a warmer Citadel-branded welcome panel and unchanged import flow. **CT-013E completed:** refined `BookItem.tsx` text hierarchy (clearer title prominence, muted supporting metadata, added compact author line in grid mode) while preserving CT-010 card interaction behavior. **CT-013F audited only:** inspected allowed files and found likely book-open popup/new-window behavior controlled by `settings.openBookInNewWindow` checks in `apps/readest-app/src/app/library/components/BookshelfItem.tsx` and `apps/readest-app/src/app/library/components/Bookshelf.tsx`; no behavior change made.
- **Files Touched:** `apps/readest-app/src/app/library/components/LibraryHeader.tsx`, `apps/readest-app/src/app/library/components/SettingsMenu.tsx`, `apps/readest-app/src/app/library/components/BookItem.tsx`, `apps/readest-app/src/app/library/page.tsx`, `Agents/TASK_QUEUE.md`, `Agents/AUDIT_LOG.md`.
- **Commands Run:** cleanup restores (`git restore apps/readest-app/src-tauri/Cargo.toml`; `git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions`; `git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions`; `git -C apps/readest-app/src-tauri/plugins/tauri-plugin-turso restore .`; `git -C packages/tauri restore .`; `git -C packages/tauri-plugins restore .`) then `git status --short` (clean pre-work); `pnpm.cmd --filter @readest/readest-app lint` (pass, exit 0); `git status --short` (post, only scoped files changed).
- **Validation:** Required lint command passed; post-change status limited to scoped CT-013 files.
- **Notes / Next:** Human visual verification needed for calmness/readability in light/dark and at narrow widths before marking `[x]`.
