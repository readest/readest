---
name: verify-lint-excludes-format-check
description: "pnpm lint does NOT run the Biome format check; run pnpm format:check too or CI's build_web_app fails on formatting"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6981cf12-3457-45a5-8161-d15457b41f63
  modified: 2026-08-30T17:14:26.873Z
---

`pnpm lint` is `tsc --noEmit && biome lint .` — **linting only, no formatting**. The
Biome *format* check is a separate script, `pnpm format:check` (which proxies to
`pnpm -w format:check` at the monorepo root).

CI's `build_web_app` job runs the format check as its "run format check" step, so
hand-wrapped code that Biome would wrap differently fails the build even when
`pnpm lint` and the full test suite are green locally.

**Why:** on PR #5949 I ran `pnpm lint` (clean) and `pnpm test` (10,538 passing), pushed,
and `build_web_app` failed on one hand-wrapped `expect(...)` in a test file I had just
written. The failure reads like a build error in the checks list; it is not.

**How to apply:** add `pnpm format:check` to the done-conditions in
`.claude/rules/verification.md` alongside `pnpm test` and `pnpm lint`, and run it before
every push. To fix an offender without touching unrelated files, format just that path:
`pnpm exec biome format --write <file>` — not a repo-wide `pnpm format`.

Related: [[feedback_dont_push_every_change]], [[notion-sync-pr-5949-review]]
