---
name: verify-format-check-gate
description: pnpm format:check (Biome formatter) is a CI + pre-push gate that pnpm lint does NOT cover; run it before pushing
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 04b03aab-c891-44f8-9ab0-8e0e757d2521
---

`pnpm lint` = `tsgo --noEmit && biome lint .` — type check + Biome **lint rules only**. It does NOT run the Biome **formatter**. Formatting is a separate gate that can fail CI even when lint+tests+tsgo are green:

- CI `build_web_app` runs `pnpm format:check || (pnpm format && git diff && exit 1)` as an early step (`biome format .`). A formatting miss fails the job before the build runs.
- The husky **pre-push** hook runs `pnpm -C apps/readest-app format:check`, `lint`, `test` against the **working tree** (not the commits being pushed).

**How to apply:** before pushing/PR, run `pnpm format:check` (or `pnpm format` to autofix) in addition to `pnpm test` + `pnpm lint`. The project's `.agents/rules/verification.md` lists test + lint but omits format:check — treat format:check as a required done-condition too.

Biome (v2.x, `biome.json`, 100-col width) mostly collapses multi-line expressions that fit on one line; tests/JSX are common offenders. To format isolated content without touching the working tree: `git show <ref>:<path> | node_modules/.bin/biome format --stdin-file-path=<path>` (idempotent, same output as `biome format --write`).

When the pre-push hook trips on **unrelated working-tree state** (e.g. a concurrent agent's WIP on another branch) and your commit content is already verified clean, push with `--no-verify` — CI re-checks everything. See [[stripe-plan-highest-active-4694]] for the same `--no-verify` pattern. zsh gotcha that bit a rebuild script: `for f in $VAR` does NOT word-split unquoted vars — use an array or quoted literals.
