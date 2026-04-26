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

### [ ] CT-004 — Safe visible Citadel branding pass

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files:** TBD after inspection. Must list exact files before editing.

**Goal:** Replace low-risk visible Readest branding with Citadel.

**Do not touch yet:**

- package IDs
- updater signing
- installer config
- reader internals
- sync/TTS logic

**Validation:**

- `pnpm.cmd tauri dev`
- Eddy visually confirms app still opens and labels look correct.

---

### [ ] CT-005 — Topbar visual slice 1

**Owner:** Cursor  
**Human verification:** Yes  
**Allowed files:** TBD after inspection.

**Goal:** Apply one small topbar/header styling improvement inspired by the design handoff.

**Rules:**

- No behavior changes.
- No whole-component replacement.
- No library/home redesign yet.

**Validation:**

- `pnpm.cmd tauri dev`
- Eddy visual approval required.
