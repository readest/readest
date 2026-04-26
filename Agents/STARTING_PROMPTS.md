# Citadel — Starting Prompts

## How to use this file

Use these prompts when opening a fresh Cursor chat/session.
Do not use old Electron/Codex/Aider prompts unless the Manager explicitly reactivates those workflows.

Current active code agent: **Cursor only**.

---

## Cursor — standard task-run prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Before coding, read only:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- .cursorrules

Then work through Agents/TASK_QUEUE.md in order.

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

Start by running git status and telling me the first task you will work on plus the exact files you expect to touch.
```

---

## Cursor — design handoff triage prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task: CT-001 — Create design handoff notes only.

Read:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- .cursorrules
- the Citadel design handoff README/SKILL/assets file list if available in the repo

Do not modify app code.
Do not implement SKILL.md.
Do not paste old Electron HTML/CSS into Readest.

Create or update:
- Agents/DESIGN_HANDOFF_NOTES.md
- Agents/AUDIT_LOG.md
- Agents/TASK_QUEUE.md

The notes should separate:
1. Assets/tokens safe to use now.
2. Prototype React components useful as references only.
3. Old Electron snippets that must not be pasted directly.
4. Recommended phased implementation order for Readest.
5. First safe app-code task after this notes pass.

Run git status before and after. Stop after logging.
```

---

## Cursor — assets-only prompt

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task: CT-002 — Copy brand assets only.

Read:
- Agents/DEVELOPMENT_RULES.md
- Agents/MASTER_PLAN.md
- Agents/TASK_QUEUE.md
- Agents/AUDIT_LOG.md
- Agents/DESIGN_HANDOFF_NOTES.md
- .cursorrules

Goal:
Copy the Citadel logo and comet assets into the correct Readest public/static asset location.

Rules:
- Do not modify UI components.
- Do not modify CSS.
- Do not modify package files.
- Do not modify Tauri config.
- Do not rename product/package IDs.
- Log exact source and destination paths.

Validation:
- git status before and after.
- Confirm copied files exist.
- Update Agents/AUDIT_LOG.md and Agents/TASK_QUEUE.md.
- Stop after the task.
```

---

## Cursor — UI task prompt template

```txt
You are working on Citadel, a Readest fork using Tauri 2 + Next.js/React/TypeScript.

Task: <TASK-ID> — <TASK NAME>

Read the standard agent files first.
Then inspect only the exact app files needed for this task.

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

After implementation:
- run the required command/check
- update Agents/AUDIT_LOG.md
- update Agents/TASK_QUEUE.md
- if visual verification is needed, mark task [~] and stop for Eddy
```
