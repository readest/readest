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

The Manager wants fewer back-and-forth one-minute prompts.
Cursor should work through a prepared task queue for longer focused runs, while stopping only for:

- build/test errors that remain after limited retries
- unclear requirements
- high-risk files not listed in the task
- UI/visual verification
- conflicting instructions

## Active agent policy

For now, **Cursor is the only active code agent**.
Do not coordinate with Aider/Codex/Claude/Gemini unless the Manager explicitly adds them later.

If multiple agents are used later:

- each agent gets different task IDs
- each agent gets different file ownership
- no two agents edit the same files/subsystems in parallel
- shared files require explicit owner assignment

## File scope discipline

- **Inspect only assigned files.** Open, search, and read **only** paths listed under the task’s **Allowed files to inspect** (and the same paths for edits under **Allowed files to edit** when implementing).
- **Use exact paths** in tasks and in your own plan (repo-relative, e.g. `apps/readest-app/src/components/Foo.tsx`). Do not substitute “the reader” or “styles” without a path list.
- **Do not use repo-wide search** (semantic search across the whole project, broad ripgrep from root, or exploratory file trees) **unless** the task explicitly says **`audit broadly`** or **`repo-wide search allowed`**.
- **If a needed file is outside the allowed list**, stop and ask the Manager to extend the task scope. Do not silently widen the list.
- **For UI tasks**, inspect **only** the component/style files named in the task plus the task docs and allowed agent files—never the whole `src` tree by default.

## Before coding every task

Cursor must output or internally record:

1. Task ID from `Agents/TASK_QUEUE.md`
2. **Allowed files to inspect** and **Allowed files to edit** from the task (verbatim path lists)
3. Exact files expected to change (must be a subset of allowed edit list)
4. Whether human visual verification is required
5. Rollback plan
6. Commands/checks planned

Then run:

```powershell
git status
```

If the tree is not clean, stop unless the dirty files are exactly part of the assigned task.

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

Do this before moving to the next task.

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

- a task asks for direct full implementation of the old handoff `SKILL.md`
- required source files are missing or ambiguous
- a migration touches renderer, Tauri, package files, and reader core in one task
- a visual task cannot be verified by automated checks
- tests/builds fail after retry limit
- Git shows unexpected unrelated changes
