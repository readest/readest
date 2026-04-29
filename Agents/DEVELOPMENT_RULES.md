# Citadel — Development Rules

## Project mode

This is an existing **Readest fork** being adapted into **Citadel**.

Current stack:

- Tauri 2 desktop shell
- Next.js / React / TypeScript frontend
- Rust backend/plugins through Tauri
- Readest/Foliate reader foundation

This is not the old Electron/EPUB.js project. Do not port old architecture directly.

## Current working style

The Manager wants fewer back-and-forth one-minute prompts. The assigned code agent should work through scoped tasks for longer focused runs, while stopping only for:

- build/test errors that remain after limited retries
- unclear requirements
- high-risk files not listed in the task
- UI/visual verification
- conflicting instructions
- unknown dirty files outside the current task scope after the known generated/plugin cleanup has been attempted

## Active agent policy

Current active implementation agent: **Codex**, unless the Manager explicitly assigns Cursor or another agent for a specific task.

Some older workflow files or queue entries may still say “Cursor.” Treat that wording as applying to the currently assigned code agent when the Manager says Codex is doing the work.

If multiple agents are used later:

- each agent gets different task IDs
- each agent gets different file ownership
- no two agents edit the same files/subsystems in parallel
- shared files require explicit owner assignment

## File scope discipline

- **Inspect only assigned files.** Open, search, and read only paths listed under the task’s **Allowed files to inspect**.
- **Edit only assigned files.** All changed files must be listed under **Allowed files to edit**.
- **Use exact repo-relative paths** in tasks and in your own plan, for example `apps/readest-app/src/app/page.tsx`.
- **Do not use repo-wide search** unless the task explicitly says `audit broadly` or `repo-wide search allowed`.
- If a needed file is outside the allowed list, stop and ask the Manager to extend the scope.
- For UI tasks, inspect only the named component/style files plus the named task docs and agent files.

## Before coding every task

The assigned code agent must output or internally record:

1. Task ID from `Agents/TASK_QUEUE.md` or the explicit one-off task ID from the Manager.
2. Allowed files to inspect and allowed files to edit, copied from the task.
3. Exact files expected to change, which must be a subset of the allowed edit list.
4. Whether human visual verification is required.
5. Rollback plan.
6. Commands/checks planned.

Then run:

```powershell
git status --short
```

## Known generated/Tauri/plugin dirt auto-clean

The Readest/Tauri dev tooling can repeatedly dirty generated permission files, plugin submodules, and `Cargo.toml`. This known generated/plugin dirt should not block every UI task.

Before stopping for a dirty tree, the assigned code agent must auto-clean the known generated/plugin paths **once**, then re-check status.

Known auto-clean paths:

- `apps/readest-app/src-tauri/Cargo.toml`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions/**`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions/**`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-turso`
- `packages/tauri-plugins`

Auto-clean command sequence from repo root:

```powershell
git restore apps/readest-app/src-tauri/Cargo.toml
git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions
git restore apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/permissions

git -C apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge restore .
git -C apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts restore .
git -C apps/readest-app/src-tauri/plugins/tauri-plugin-turso restore .
git -C packages/tauri-plugins restore .

git status --short
```

Rules for this cleanup:

- Clean only the known generated/plugin paths above.
- Do **not** run broad destructive cleanup commands such as `git restore .`, `git reset --hard`, `git clean -fd`, or `git submodule foreach --recursive git restore .`.
- Do **not** clean user/task work in app, docs, or agent files unless the task explicitly asks for it.
- Pre-existing dirty files outside the task scope may remain dirty if they are known ongoing work; leave them untouched and continue if they do not conflict with the current task.
- If unknown dirty files remain outside the current task scope and outside the known generated/plugin paths, stop and report them before editing.

After cleanup, continue only when the remaining dirty files are either:

- part of the assigned task’s allowed edit list, or
- explicitly identified as pre-existing non-conflicting work to ignore.

## During coding

- Stay inside the current task.
- Do not expand scope because a neighboring issue is visible.
- Do not refactor unrelated Readest systems.
- Do not rename existing exported types/components unless required.
- Keep changes reversible.
- Prefer small CSS/token/component changes before touching reader behavior.
- For design handoff work, adapt the idea to Readest; do not paste old Electron code wholesale.

## Retry policy

When a command fails:

1. Diagnose the likely root cause.
2. Make one focused fix.
3. Re-run the relevant command.
4. Repeat once if needed.

Maximum autonomous retries: **2**.
A 3rd attempt is allowed only for a trivial typo/environment correction.
After that, stop, log the failure, and ask for Manager/ChatGPT guidance.

## Audit log policy

After every task attempt, update:

```txt
Agents/AUDIT_LOG.md
```

The log entry must include:

- timestamp with Europe/Lisbon
- agent name
- task ID
- status
- files touched
- commands run
- validation result
- notes/next action

Do this before moving to the next task unless the Manager explicitly says the task is page-only/no-docs.

## Task queue policy

Update:

```txt
Agents/TASK_QUEUE.md
```

Use statuses:

- `[ ]` not started
- `[>]` active
- `[~]` implemented, waiting for human verification
- `[x]` complete
- `[!]` blocked

For UI tasks, use `[~]` until Eddy visually approves.

## Commit policy

Do not commit automatically unless the task explicitly allows it.

Recommended behavior:

- docs-only or rules tasks: commit allowed if requested
- code tasks: no commit until checks pass
- UI tasks: no final completion until visual verification

Always keep the working tree understandable.

## Validation commands

Use the smallest useful validation for the task.

Common commands from repo root:

```powershell
pnpm.cmd --filter @readest/readest-app lint
pnpm.cmd --filter @readest/readest-app test
pnpm.cmd tauri dev
pnpm.cmd tauri build
```

Notes:

- Use `pnpm.cmd`, not `pnpm`, in normal PowerShell if script execution is blocked.
- Full test suite may currently have unrelated local/upstream failures around `localStorage` and Windows path separators. Do not treat unrelated existing test failures as caused by a docs/UI token task; log them clearly.
- Tauri release build may require the Visual Studio Developer shell so native C headers are available.

## Design implementation order

Use this order unless the Manager changes it:

1. Design notes and asset inventory
2. Copy brand assets only
3. Add Citadel design tokens only
4. Safe user-facing branding
5. Topbar/header polish
6. Library/home visual pass
7. Reader chrome polish
8. Companion/sidebar features
9. Audiobook/voice/sync UI

## Hard stops

Stop immediately if:

- a task asks for direct full implementation of old Electron handoff code
- required source files are missing or ambiguous
- a migration touches renderer, Tauri, package files, and reader core in one task
- a visual task cannot be verified by automated checks and needs Eddy’s confirmation
- tests/builds fail after retry limit
- Git shows unexpected unrelated changes after the known generated/plugin cleanup has already been attempted
