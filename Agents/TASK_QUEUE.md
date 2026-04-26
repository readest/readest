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
