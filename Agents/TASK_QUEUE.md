# Citadel — Cursor Task Queue

## File scope (mandatory)

**Every task must declare file scope before implementation:** the prompt or queue entry must include **Allowed files to inspect** and **Allowed files to edit** (exact paths or Manager-approved globs). Tasks without explicit file scope are **invalid**—do not start them; ask the Manager to add scope first.

## Status legend

- `[ ]` not started
- `[>]` active
- `[~]` implemented, waiting for human verification
- `[x]` complete
- `[!]` blocked

## Current rules

- Active agent: Cursor only.
- Work tasks in order.
- After every task attempt, update `Agents/AUDIT_LOG.md`.
- Stop on UI verification tasks until Eddy confirms.
- Maximum autonomous fixes after a failed command: 2.

---

## Queue: Workflow maintenance

### [x] WORKFLOW-001 — Require explicit file scope in every agent task

**Owner:** Cursor  
**Human verification:** No  
**Allowed files to inspect:**

- `.cursorrules`
- `Agents/DEVELOPMENT_RULES.md`
- `Agents/STARTING_PROMPTS.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `Agents/MASTER_PLAN.md`

**Allowed files to edit:**

- `.cursorrules`
- `Agents/DEVELOPMENT_RULES.md`
- `Agents/STARTING_PROMPTS.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Agents never search or edit outside task-declared paths unless the task explicitly allows broad audit/repo-wide search.

**Validation:** `git status --short`; pattern check on updated docs; `git diff --stat`.

---

## Queue: Workflow foundation

### [>] CT-000 — Update agent workflow files for Readest pivot

**Owner:** Cursor  
**Human verification:** No  
**Allowed files:**

- `.cursorrules`
- `Agents/DEVELOPMENT_RULES.md`
- `Agents/MASTER_PLAN.md`
- `Agents/STARTING_PROMPTS.md`
- `Agents/AUDIT_LOG.md`
- `Agents/LEGACY_ELECTRON_AUDIT_LOG.md`
- `Agents/TASK_QUEUE.md`
- `Agents/DESIGN_HANDOFF_NOTES.md`

**Goal:** Replace old Electron workflow assumptions with Readest/Tauri workflow rules.

**Validation:**

- `git status`
- Manually confirm docs are updated and old audit log is archived.

**Completion:** Mark `[x]` only after the updated files are present.

---

## Queue: Design handoff triage

### [ ] CT-001 — Create design handoff notes only

**Owner:** Cursor  
**Human verification:** No  
**Allowed files:**

- `Agents/DESIGN_HANDOFF_NOTES.md`
- `Agents/AUDIT_LOG.md`
- `Agents/TASK_QUEUE.md`

**Goal:** Summarize the design handoff for the Readest app. Do not modify app code.

**Instructions:**

- Identify useful assets: logo, comet, color/type tokens.
- Identify prototype/reference-only files.
- Identify old Electron-only handoff snippets.
- Recommend implementation order.

**Validation:**

- No app source files changed.
- `git status` shows only allowed docs changed.

---

### [x] CT-002 — Copy brand assets only

**Owner:** Cursor  
**Human verification:** No  
**Allowed files:**

- selected public/static asset destination under `apps/readest-app/**`
- `Agents/AUDIT_LOG.md`
- `Agents/TASK_QUEUE.md`

**Goal:** Copy Citadel logo/comet assets into the Readest app without using them in UI yet.

**Instructions:**

- Inspect existing public/static asset conventions first.
- Copy assets only.
- Do not modify components, CSS, package files, or Tauri config.

**Validation:**

- `git status`
- Confirm files exist at destination.
- Optional: run dev app only if needed.

---

### [x] CT-003 — Add Citadel design tokens only

**Owner:** Cursor  
**Human verification:** No  
**Allowed files:**

- current global style/token file if identified
- or a new isolated Citadel token CSS file
- `Agents/AUDIT_LOG.md`
- `Agents/TASK_QUEUE.md`

**Goal:** Add color/type tokens without changing visible UI broadly.

**Instructions:**

- Use tokens from the handoff as reference.
- No layout changes.
- No reader behavior changes.
- No dependency additions.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint` if style/code changes touch TypeScript.
- `git status`.

---

## Queue: First visible branding

### [~] CT-004 — Safe visible Citadel branding pass

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/layout.tsx`
- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/user/layout.tsx`
- `apps/readest-app/src/app/offline/page.tsx`
- `apps/readest-app/src/components/AboutWindow.tsx`
- `apps/readest-app/src/components/SupportLinks.tsx`
- `apps/readest-app/src/components/UpdaterWindow.tsx`
- `apps/readest-app/src-tauri/tauri.conf.json` (inspect only; no edits)

**Allowed files to edit:** same as inspect, except `tauri.conf.json` is not edited.

**Goal:** Replace low-risk visible Readest branding with Citadel.

**Do not touch yet:**

- package IDs
- updater signing
- installer config
- reader internals
- sync/TTS logic

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint` (pass)
- `pnpm.cmd tauri dev`
- Eddy visually confirms app still opens and labels look correct.

---

### [~] CT-005 — Tauri shell title / product display name

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect / edit:**

- `apps/readest-app/src-tauri/tauri.conf.json`
- `apps/readest-app/package.json`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Desktop window / shell shows **Citadel** via Tauri `productName` (and safe related display strings only).

**Do not change in this task:** `mainBinaryName`, bundle `identifier`, asset scope paths (`**/Readest/**/*`), updater URLs/keys, `package.json` scripts that reference Cargo package `Readest` or `Readest.ipa`, icons, Rust sources.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `pnpm.cmd tauri dev` — confirm window/title bar shows Citadel.

---

### [~] CT-006 — Tauri bundle icons → Citadel handoff exports

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect / edit:**

- `Agents/handoff/**`
- `apps/readest-app/src-tauri/tauri.conf.json`
- `apps/readest-app/src-tauri/icons/**`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Replace Windows/macOS bundle icons referenced by Tauri with Citadel exports from `Agents/handoff/` (same paths in `tauri.conf.json`).

**Validation:**

- `git status --short`
- `pnpm.cmd --filter @readest/readest-app lint`
- Human: taskbar / window / installer icon looks correct after a real `tauri build` or dev run in a VS Native Tools environment.

---

### [~] CT-007 / CT-007B — Visible desktop window title → Citadel

**Owner:** Cursor  
**Human verification:** Yes  
**Goal:** Native title bar shows **Citadel** (not **Readest**) on desktop Tauri.

**Implementation notes (CT-007B):** Non-macOS desktop **main** window title is set in `apps/readest-app/src-tauri/src/lib.rs` via `WebviewWindowBuilder::… .title("Citadel")`. Reader / library **WebviewWindow** instances use `title: 'Citadel'` in `apps/readest-app/src/utils/nav.ts`. The JS `setTitle('Citadel')` workaround was removed because Tauri denies `window.set_title` without `core:window:allow-set-title` (that permission is intentionally not added).

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- Grep: no `setTitle('Citadel')` in the app; `lib.rs` has `.title("Citadel")` (not `"Readest"`) for the non-mac main window.
- Eddy: `pnpm.cmd tauri dev` (VS Native Tools if needed) — confirm title bar reads **Citadel**.

---

### [x] CT-008 — Visible Readest menu labels → Citadel

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect / edit:**

- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`
- `apps/readest-app/src/services/commandRegistry.ts`
- `apps/readest-app/src/pages/_app.tsx`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Replace obvious user-facing product strings **Readest** → **Citadel** in menus, command palette action labels, and `_app.tsx` PWA/meta copy only (no URLs, constant names, storage paths, or reader behavior).

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- Eddy: spot-check library settings menu, reader book menu, command palette, and install/home-screen title where applicable.

---

### [x] CT-009 — Topbar visual slice 1 (library shell)

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/components/**`
- `apps/readest-app/src/styles/globals.css`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:** The component that renders the library header/topbar (`LibraryHeader`), optional tiny scoped rules in `globals.css`, plus `Agents/TASK_QUEUE.md` and `Agents/AUDIT_LOG.md`.

**Goal:** One small Citadel polish on the library topbar — subtle editorial surface, warm gold accent (border / focus / hovers), CT-003 tokens only; no reader, Tauri, or dependency changes.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- Eddy: visual check of library header in light/dark.

---

### [x] CT-010 — Library book card visual slice 1

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `Agents/DEVELOPMENT_RULES.md`
- `Agents/MASTER_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/**`
- `apps/readest-app/src/components/**` only if directly imported by the library book card component
- `apps/readest-app/src/styles/globals.css` (read-only for existing Citadel tokens)

**Allowed files to edit:**

- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Apply a small visual-only Citadel polish to visible library book tiles/cards (border, hover/focus, depth, subtle accent), preserving all existing behavior and data flow.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- Eddy: visual confirmation of card polish in library grid/list.

---

### [x] CT-011 — Create Citadel UX simplification plan only

**Owner:** Cursor  
**Human verification:** No  
**Allowed files to inspect:**

- `Agents/MASTER_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/DESIGN_HANDOFF_NOTES.md`
- `docs/CITADEL_ARCHITECTURE_AUDIT.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx`

**Allowed files to edit:**

- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Write a practical docs-only plan to evolve the default library/settings-heavy experience into a calmer Citadel UX while preserving existing Readest capability.

**Validation:**

- `git status --short` before and after.
- No lint required for docs-only task.

---

### [x] CT-012 — Library calm/home batch

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/styles/globals.css`

**Allowed files to edit:**

- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Implement one UI batch (CT-012A/B/C) to reduce first-glance density on library home without changing reader/data/settings behavior.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`
- Human visual verification required.

---

### [x] CT-013 — Library simplification batch

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/services/commandRegistry.ts`

**Allowed files to edit:**

- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`

**Goal:** Continue reducing first-glance library overwhelm by de-emphasizing advanced controls, improving settings/menu rhythm, and refining tile/empty-state hierarchy without behavior rewrites.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`
- Human visual verification required.

---

### [~] CT-014 — Book opening flow + calmer library entry audit/fix batch

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/store/**`
- `apps/readest-app/src/services/**`

**Allowed files to edit:**

- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`

**Goal:** Reduce book-opening friction by auditing new-window behavior, applying safe clarity/default improvements where scoped, and polishing calmer entry copy.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`

---

### [~] CT-015 — Default book opening to same window

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`

**Allowed files to edit:**

- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`

**Goal:** Keep separate-window opening as an option while making same-window reading the default base experience.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`

---

### [~] CT-016 — Make book opening setting easy to find

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect/edit:**

- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Move the existing separate-window toggle higher in Library settings under a clear “Book opening” section label, without changing behavior.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`

---

### [x] CT-017 — Audit existing settings / toggles / configurable features

**Owner:** Cursor  
**Human verification:** No  
**Allowed files to inspect:**

- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/services/appService.ts`
- `apps/readest-app/src/services/nativeAppService.ts`
- `apps/readest-app/src/services/nodeAppService.ts`
- `apps/readest-app/src/store/**`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/reader/components/**`
- `apps/readest-app/src/components/**`
- `apps/readest-app/src/hooks/**`
- `apps/readest-app/src/types/**`
- `apps/readest-app/src/utils/**`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `docs/CITADEL_SETTINGS_AUDIT.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Create a docs-only audit of existing settings/toggles/configurable behavior so Citadel UX work reuses current capabilities instead of rebuilding.

**Validation:**

- `git status --short` before and after.
- No lint required (docs-only).

---

### [x] CT-018 — Split Citadel Home and Library entry experience

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `docs/CITADEL_SETTINGS_AUDIT.md`
- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/**`
- `apps/readest-app/src/components/**`
- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/services/appService.ts`
- `apps/readest-app/src/services/nativeAppService.ts`
- `apps/readest-app/src/store/**`
- `apps/readest-app/src/styles/globals.css`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/styles/globals.css`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Split entry IA so `/` is a calm Home surface and `/library` remains the full collection management destination without changing reader/data architecture.

**Validation:**

- `git status --short` before edits.
- `pnpm.cmd --filter @readest/readest-app lint`
- Human visual verification required before marking complete.

---

### [x] CT-019 — Home visual pass 1: richer landing page, covers, better contrast

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/components/AppTitleBar.tsx`
- `apps/readest-app/src/components/**`
- `apps/readest-app/src/styles/globals.css`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/styles/globals.css` (tiny reusable class only if needed)
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Visually polish Home only (continue readability, cover treatment, recent preview covers, softer accent usage, wide-screen composition) while preserving CT-018 split and existing behavior.

**Validation:**

- `git status --short` before edits.
- `pnpm.cmd --filter @readest/readest-app lint`
- Human visual verification required.

---

### [x] CT-020 — Home polish pass: readability, bottom shelf, responsive layout

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect/edit:**

- `apps/readest-app/src/app/page.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md` (if update needed)
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Home-only visual polish for improved contrast/readability, compact bottom recent shelf behavior, and graceful responsive stacking in non-fullscreen/narrow windows.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`

---

### [x] CT-021 — Home layout pass: Currently Reading showcase + bottom book shelf

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/components/AppTitleBar.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Rework Home content below the shared topbar into a centered currently-reading showcase and a more substantial bottom cover shelf while preserving search behavior and keeping Home premium/readable.

**Validation:**

- `git status --short`
- `pnpm.cmd --filter @readest/readest-app lint`

---

### [x] CT-022 — Home stage layout pass: atmospheric reading showcase + real bottom shelf

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/page.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Rework Home below the unchanged topbar into an atmospheric reading stage with a central currently-reading showcase, clear primary continue action, and a bottom-anchored cover shelf.

**Validation:**

- `git status --short`
- `pnpm.cmd --filter @readest/readest-app lint`

---

### [x] CT-023 — Home design-system alignment: no scrollbar, darker stage, reactive cover glow, bigger shelf

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to inspect:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/components/AppTitleBar.tsx`
- `apps/readest-app/src/styles/globals.css`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/styles/globals.css` (if needed)
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Align Home stage visuals to Citadel design tokens (darker palette, readable type, reactive ambient cover glow, viewport-fit composition, and larger anchored bottom shelf) without touching library/reader behavior.

**Validation:**

- `git status --short`
- `pnpm.cmd --filter @readest/readest-app lint`

---

### [x] CT-024 — Home focused refinement: stronger glow, larger dock, responsive/clipping fixes

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `apps/readest-app/src/components/AppTitleBar.tsx` (only if truly needed)
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Refine Home stage composition with stronger reactive ambient glow, darker topbar tone, larger bottom shelf dock, and robust non-fullscreen responsiveness/clipping behavior while preserving existing Home interactions.

**Validation:**

- `git status --short`
- `pnpm.cmd --filter @readest/readest-app lint`

---

### [x] CT-025 — Home editorial split + cinematic dock refinement

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files to edit:**

- `apps/readest-app/src/app/page.tsx`
- `docs/CITADEL_UX_SIMPLIFICATION_PLAN.md`
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

**Goal:** Move Home to the target reference while keeping topbar behavior unchanged: left editorial metadata + right featured cover hero, darker cinematic stage, stronger blurred cover-reactive glow, and a wider/larger dock-like bottom shelf (cover-first) while preserving search/no-results and Continue/Import/Library actions.

**Validation:**

- `pnpm.cmd --filter @readest/readest-app lint`
- `git status --short`
- **Eddy: visually confirm hero orientation (left text/right cover), stronger glow, and shelf scale in `tauri dev` before marking complete.**

**CT-025B polish note (current pass):**

- Scope-limited touch-up only in allowed files: logo aspect-safe sizing, one-step title clamp reduction, split-hero spacing rebalance, softer shelf cover treatment, and more readable `View all`.
