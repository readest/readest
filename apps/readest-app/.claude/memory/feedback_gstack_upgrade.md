---
name: gstack upgrade location
description: Always upgrade gstack from the project directory (.claude/skills/gstack), not from a global install
type: feedback
---

When upgrading gstack, always run the upgrade from the current project's `.claude/skills/gstack` directory (local-git install), not from a global install path.

**Why:** The project uses a local-git gstack install at `apps/readest-app/.claude/skills/gstack`. Previous mistakes upgraded a global copy while the project's local copy stayed outdated.

**How to apply:** When `/gstack-upgrade` is invoked, ensure the `cd` and `git reset --hard origin/main && ./setup` happen inside the project's `.claude/skills/gstack` directory.
