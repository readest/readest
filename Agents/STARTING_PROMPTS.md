# Citadel — Starting Prompts

## How to use this file

Use these prompts when opening a fresh Codex/Cursor chat/session.

Current active code agent: **Codex**, unless Eddy explicitly assigns Cursor or another agent for a task.

Historical “Cursor” wording in older task entries means the currently assigned code agent when Codex is doing the work.

Every real task prompt must include the sections in the universal task wrapper below. Tasks without **Allowed files to inspect** and **Allowed files to edit** are invalid—the agent should refuse until scope is added.

---

## Mandatory pre-edit cleanup rule

Add this rule to normal task prompts unless the task is docs-only and no app checks are needed:

```txt
Pre-edit generated/plugin cleanup:
Run git status --short. If known generated/Tauri/plugin dirt appears, auto-clean the known generated/plugin paths once using Agents/DEVELOPMENT_RULES.md, then re-check git status --short. Do not stop for that known dirt unless cleanup fails. Do not clean app/docs/agent files outside the task scope. Continue only if remaining dirty files are task files or explicitly pre-existing non-conflicting work.
```

Known generated/plugin paths are:

- `apps/readest-app/src-tauri/Cargo.toml`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions/**`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions/**`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-turso`
- `packages/tauri-plugins`

Never use broad cleanup commands like `git restore .`, `git reset --hard`, `git clean -fd`, or recursive submodule restore unless Eddy explicitly requests it.

---

## Universal task wrapper

Paste this skeleton and replace angle-bracket placeholders. Lists must be exact repo-relative paths or explicit globs Eddy approved.

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

Pre-edit cleanup:
- Run git status --short.
- Auto-clean known generated/Tauri/plugin dirt once using Agents/DEVELOPMENT_RULES.md.
- Re-check git status --short.
- Stop only for unknown/conflicting dirt.

Validation:
- <exact commands, e.g. git status --short, pnpm.cmd --filter @readest/readest-app lint>

Audit log requirement:
- After this attempt, append one entry to Agents/AUDIT_LOG.md (Europe/Lisbon timestamp, task ID, files touched, commands, validation) before starting another task.

Stop conditions:
- <e.g. stop after logging; stop if a command fails twice; stop if scope is unclear>

Project context: Citadel is a Readest fork (Tauri 2 + Next.js/React/TypeScript). Codex is the default active code agent unless Eddy says otherwise.
```

---

## Standard task-run prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: <from Agents/TASK_QUEUE.md or Eddy’s one-off task>
Goal: <what this session should accomplish>

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- <any exact paths the current task names>

Allowed files to edit:
- <only exact paths the current task allows>

Forbidden files/areas:
- Everything not listed under Allowed files to inspect / edit.
- No repo-wide search unless the task says "audit broadly" or "repo-wide search allowed".
- No Tauri/Rust/package/generated files unless explicitly listed.

Pre-edit cleanup:
- Run git status --short.
- Auto-clean known generated/Tauri/plugin dirt once using Agents/DEVELOPMENT_RULES.md.
- Re-check git status --short.
- Do not stop for known generated/plugin dirt unless cleanup fails.
- Leave unrelated Library/docs/App files untouched unless explicitly allowed.

Validation:
- <task-specific commands>
- git status --short before and after

Audit log requirement:
- Append a full entry to Agents/AUDIT_LOG.md after each task attempt unless Eddy explicitly says page-only/no-docs.

Stop conditions:
- Stop if Allowed files to inspect/edit sections are missing.
- Stop if a needed file is outside scope.
- Stop after completing the one active task and logging, unless Eddy explicitly continues.

Rules:
- Use the currently assigned code agent. Current default is Codex unless Eddy says Cursor.
- Do not work on more than one task at a time.
- Do not modify files outside the current task's allowed file list.
- If a command fails, try to fix it at most 2 times. A 3rd attempt is allowed only for a trivial typo/environment correction. Then stop and ask for guidance.
- If a task requires human visual verification, implement it, run the requested command, mark it [~], log it, and stop for Eddy to verify.
- Do not commit unless the task explicitly says commits are allowed.

Start by running the pre-edit generated/plugin cleanup rule, then tell me the task you will work on and exact files you expect to touch.
```

---

## UI task prompt template

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task ID: <TASK-ID>
Goal: <TASK NAME — one line>

Allowed files to inspect:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- <list every component/style/module path you will open — no blanket src/**>

Allowed files to edit:
- <subset of inspected paths that may change>

Forbidden files/areas:
- Any path not listed above.
- Reader core, stores, services, Tauri, packages unless explicitly listed.
- Repo-wide search unless task says "audit broadly" or "repo-wide search allowed".

Pre-edit cleanup:
- Run git status --short.
- Auto-clean known generated/Tauri/plugin dirt once using Agents/DEVELOPMENT_RULES.md.
- Re-check git status --short.
- Stop only for unknown/conflicting dirt.

Validation:
- <exact commands from task, e.g. pnpm.cmd --filter @readest/readest-app lint>

Audit log requirement:
- Append Agents/AUDIT_LOG.md after the attempt unless Eddy explicitly says no docs/Agents for this micro-pass.
- Update Agents/TASK_QUEUE.md if it is listed in Allowed files to edit.

Stop conditions:
- Stop and ask if scope is missing or you need a file outside the allowed list.
- If human visual verification is required, mark [~], log, and stop for Eddy.

Before editing, report:
1. exact files you expect to change
2. rollback plan
3. whether human visual verification is required
4. command/check you will run

Rules:
- No broad rewrites.
- No dependency additions.
- No reader behavior changes unless task explicitly says so.
- No package/build naming changes unless task explicitly says so.
- Keep changes small and reversible.
```

---

## Page-only micro-pass prompt

Use this when visually iterating on `apps/readest-app/src/app/page.tsx` and you want zero docs churn.

```txt
Task ID: <TASK-ID>
Goal: <tiny visual fix>

Allowed files to inspect:
- apps/readest-app/src/app/page.tsx
- <optional exact read-only component path>

Allowed files to edit:
- apps/readest-app/src/app/page.tsx

Forbidden files/areas:
- Agents/**
- docs/**
- apps/readest-app/src/app/library/**
- apps/readest-app/src-tauri/**
- packages/**
- package/lock files

Pre-edit cleanup:
- Run git status --short.
- Auto-clean known generated/Tauri/plugin dirt once using Agents/DEVELOPMENT_RULES.md.
- Re-check git status --short.
- Existing dirty Library/docs/Agents files are pre-existing and must be ignored, not edited.

Validation:
- pnpm.cmd --filter @readest/readest-app lint
- git status --short

Stop conditions:
- If you need any file outside scope, stop and report.
- Do not update docs or audit log for this micro-pass.
```
