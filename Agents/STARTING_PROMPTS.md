# Citadel — Starting Prompts

## How to use this file

Use these prompts when opening a fresh Cursor chat/session.
Do not use old Electron/Codex/Aider prompts unless the Manager explicitly reactivates those workflows.

Current active code agent: **Cursor only**.

Every real task prompt you send to Cursor **must** include all sections in **Cursor — universal task wrapper** below (copy the wrapper and fill in the lists). Tasks without **Allowed files to inspect** and **Allowed files to edit** are invalid—Cursor should refuse until scope is added.

---

## Cursor — universal task wrapper (use for every task)

Paste this skeleton and replace angle-bracket placeholders. Lists must be **exact repo-relative paths** or explicit globs the Manager approved.

```txt
Task ID: <TASK-ID>
Goal: <one sentence>

Allowed files to inspect:
- <path or doc>
- ...

Allowed files to edit:
- <path>
- ...

Forbidden files/areas:
- <e.g. apps/readest-app/src/** not listed above, package.json, src-tauri, pnpm-lock.yaml, …>

Validation:
- <exact commands, e.g. git status, pnpm.cmd --filter @readest/readest-app lint>

Audit log requirement:
- After this attempt, append one entry to Agents/AUDIT_LOG.md (Europe/Lisbon timestamp, task ID, files touched, commands, validation) before starting another task.

Stop conditions:
- <e.g. stop after logging; stop if a command fails twice; stop if scope is unclear>

Project context: Citadel is a Readest fork (Tauri 2 + Next.js/React/TypeScript). Cursor is the only active agent unless the Manager says otherwise.
```

---

## Cursor — standard task-run prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: <from Agents/TASK_QUEUE.md — e.g. CT-003>
Goal: <what this session should accomplish>

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- .cursorrules
- <any paths the current task names>

Allowed files to edit:
- <only paths the current task allows — often app files + Agents/AUDIT_LOG.md + Agents/TASK_QUEUE.md>

Forbidden files/areas:
- Everything not listed under Allowed files to inspect / edit. No repo-wide search unless the task says "audit broadly" or "repo-wide search allowed".

Validation:
- <task-specific commands>
- git status before and after

Audit log requirement:
- Append a full entry to Agents/AUDIT_LOG.md after each task attempt (timestamp Europe/Lisbon).

Stop conditions:
- Stop if Allowed files to inspect/edit sections were missing from the user message—ask for a scoped task.
- Stop after completing the one active task and logging, unless the Manager explicitly continues.

Then work through Agents/TASK_QUEUE.md in order (first [>] or first [ ]).

Rules:
- Cursor is the only active agent.
- Do not work on more than one task at a time.
- Do not skip ahead.
- Do not modify files outside the current task's allowed file list.
- After each task attempt, append a timestamped entry to Agents/AUDIT_LOG.md.
- Update the task status in Agents/TASK_QUEUE.md.
- If a command fails, try to fix it at most 2 times. A 3rd attempt is allowed only for a trivial typo/environment correction. Then stop and ask for guidance.
- If a task requires human visual verification, implement it, run the requested command, mark it [~], log it, and stop for Eddy to verify.
- Do not commit unless the task explicitly says commits are allowed.

Start by running git status and telling me the first task you will work on plus the exact files you expect to touch (must match Allowed files to edit).
```

---

## Cursor — design handoff triage prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: CT-001
Goal: Create design handoff notes only (no app implementation).

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- .cursorrules
- Agents/handoff/** (or exact paths Manager lists for the design package)
- Add here any other paths CT-001 explicitly lists in TASK_QUEUE.md

Allowed files to edit:
- Agents/DESIGN_HANDOFF_NOTES.md
- Agents/AUDIT_LOG.md
- Agents/TASK_QUEUE.md

Forbidden files/areas:
- App source under apps/readest-app/src/**
- package.json, pnpm-lock.yaml, Tauri/Rust, public assets not explicitly allowed
- Repo-wide search unless task says "audit broadly" or "repo-wide search allowed"

Validation:
- git status before and after; confirm no app source files changed.

Audit log requirement:
- Append Agents/AUDIT_LOG.md after the attempt.

Stop conditions:
- Stop after notes + queue + log updates; do not start CT-002 in the same run unless Manager asks.

Do not implement SKILL.md.
Do not paste old Electron HTML/CSS into Readest.

The notes should separate:
1. Assets/tokens safe to use now.
2. Prototype React components useful as references only.
3. Old Electron snippets that must not be pasted directly.
4. Recommended phased implementation order for Readest.
5. First safe app-code task after this notes pass.
```

---

## Cursor — assets-only prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: CT-002
Goal: Copy the Citadel logo and comet assets into the correct Readest public/static asset location only.

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- Agents/DESIGN_HANDOFF_NOTES.md
- .cursorrules
- Exact source paths Manager provides (e.g. Desktop or Agents/handoff/...)
- Destination parent directory under apps/readest-app/public/ (list exact folder in task)

Allowed files to edit:
- Only the destination asset files named in TASK_QUEUE (e.g. apps/readest-app/public/citadel/citadel-logo.png, apps/readest-app/public/citadel/comet.png)
- Agents/AUDIT_LOG.md
- Agents/TASK_QUEUE.md

Forbidden files/areas:
- apps/readest-app/src/**
- CSS/components
- package files, Tauri/Rust
- Repo-wide search unless "audit broadly" / "repo-wide search allowed"

Validation:
- git status before and after
- Confirm copied files exist at destination paths

Audit log requirement:
- Append Agents/AUDIT_LOG.md; update Agents/TASK_QUEUE.md status.

Stop conditions:
- Stop after copy + log + queue update; no UI wiring in same task.
```

---

## Cursor — UI task prompt template

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: <TASK-ID>
Goal: <TASK NAME — one line>

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- .cursorrules
- <list every component/style/module path you will open—no blanket "src/**">

Allowed files to edit:
- <subset of inspected paths that may change>
- Agents/AUDIT_LOG.md
- Agents/TASK_QUEUE.md

Forbidden files/areas:
- Any path not listed above; reader core, stores, services, Tauri, packages—unless explicitly in Allowed files to edit
- Repo-wide search unless task says "audit broadly" or "repo-wide search allowed"

Validation:
- <exact commands from task, e.g. lint filter, pnpm.cmd tauri dev if task requires>

Audit log requirement:
- Append Agents/AUDIT_LOG.md after the attempt; update task status in Agents/TASK_QUEUE.md.

Stop conditions:
- Stop and ask if scope is missing or you need a file outside the allowed list.
- If human visual verification: mark [~], log, stop for Eddy.

Before editing, report:
1. exact files you expect to change (must match Allowed files to edit)
2. rollback plan
3. whether human visual verification is required
4. command/check you will run

Rules:
- No broad rewrites.
- No dependency additions.
- No reader behavior changes unless task explicitly says so.
- No package/build naming changes unless task explicitly says so.
- Keep changes small and reversible.

After implementation:
- run the required command/check
- update Agents/AUDIT_LOG.md
- update Agents/TASK_QUEUE.md
- if visual verification is needed, mark task [~] and stop for Eddy
```
