## Project Overview

Readest is a cross-platform ebook reader built as a **Next.js 16 + Tauri v2** hybrid app. It's part of a pnpm monorepo at `/apps/readest-app/`. The app runs on web (CloudFlare Workers), desktop (macOS/Windows/Linux via Tauri), and mobile (iOS/Android via Tauri).

## Common Commands

```bash
# Development
pnpm dev-web               # Web-only dev server (no Rust compilation needed)
pnpm tauri dev             # Desktop dev with Tauri (compiles Rust backend)

# Building
pnpm build                 # Build Next.js for Tauri
pnpm build-web             # Build Next.js for web deployment

# Testing (see [docs/testing.md](docs/testing.md) for full details)
pnpm test                  # Unit tests (vitest + jsdom)
pnpm test -- src/__tests__/utils/misc.test.ts  # Run a single test file
pnpm test -- --watch       # Watch mode
pnpm test:browser          # Browser tests (Chromium via Playwright)
pnpm tauri:dev:test        # Start Tauri app with webdriver
pnpm test:tauri            # Run Tauri integration tests

# Linting & Formatting
pnpm lint                  # Biome (linter) + tsgo (type check)
pnpm format                # Prettier (runs from monorepo root)
pnpm format:check          # Check formatting without writing

# Rust
pnpm fmt:check             # Check formatting Rust code (src-tauri)
pnpm clippy:check          # Lint Rust code (src-tauri)
```

### Source Layout

| Directory         | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `src/app/`        | Next.js App Router pages and API routes                       |
| `src/components/` | React components (reader, settings, library, assistant, etc.) |
| `src/services/`   | Business logic: TTS, translators, OPDS, sync, AI, metadata    |
| `src/store/`      | Zustand state stores                                          |
| `src/hooks/`      | Custom React hooks                                            |
| `src/libs/`       | Document loaders, payment, storage, sync                      |
| `src/utils/`      | Pure utility functions                                        |
| `src/types/`      | TypeScript type definitions                                   |
| `src/context/`    | React Context providers (Auth, Env, Sync, etc.)               |
| `src/workers/`    | Web Workers for background tasks                              |
| `src-tauri/`      | Rust backend: Tauri plugins, platform-specific code           |

### Path Aliases (tsconfig)

- `@/*` → `./src/*`
- `@/components/ui/*` → `./src/components/primitives/*`

### Rust Backend (`src-tauri/`)

Platform-specific code lives in `src-tauri/src/{macos,windows,android,ios}/`. Custom Tauri plugins are in `src-tauri/plugins/`.

## Git Worktrees

Always use `pnpm worktree:new <branch-name|pr-number>` to create worktrees. Never use `git worktree add` directly — the script handles submodule initialization (simplecc WASM, foliate-js), dependency installation, `.env` copying, vendor assets, and Tauri gen symlinks that are required for lint and tests to pass.

```bash
pnpm worktree:new feat/my-feature   # New branch from origin/main
pnpm worktree:new 3837              # Checkout PR #3837 with push access to fork
```

## Project Rules

Rules are in `.claude/rules/`: test-first, typescript, verification.

### i18n

See [docs/i18n.md](docs/i18n.md) for the key-as-content translation approach, `stubTranslation` usage in non-React modules, and extraction workflow.

### Safe Area Insets

See [docs/safe-area-insets.md](docs/safe-area-insets.md) for rules on handling top/bottom insets for UI elements near screen edges.

Available gstack skills:

- `/plan-ceo-review` — CEO/founder-mode plan review
- `/plan-eng-review` — Eng manager-mode plan review
- `/plan-design-review` — Designer's eye review of a live site
- `/design-consultation` — Design system consultation
- `/review` — Pre-landing PR review
- `/ship` — Ship workflow (merge, test, review, bump, PR)
- `/browse` — Fast headless browser for QA and site interaction
- `/qa` — QA test and fix bugs
- `/qa-only` — QA report only (no fixes)
- `/qa-design-review` — Designer's eye QA with fixes
- `/setup-browser-cookies` — Import cookies for authenticated testing
- `/retro` — Weekly engineering retrospective
- `/document-release` — Post-ship documentation update

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.

---

## Citadel Multi-Agent Workflow

### Agent Operating Modes

Every Citadel agent must follow three sequential modes: **Plan**, **Build**, **Verify**.

#### Plan Mode

Before coding, every agent must produce:

| Deliverable        | Description                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Task Understanding | What problem is being solved and why.                                                                                 |
| Expected Files     | List of files that will be created or modified.                                                                       |
| Collision Check    | Cross-reference against [AGENT_OWNERSHIP.md](../docs/AGENT_OWNERSHIP.md) — does this task touch another agent's area? |
| Validation Plan    | Which tests/lint/manual checks will confirm success.                                                                  |
| Stop Conditions    | What would cause the agent to stop and report instead of proceeding.                                                  |

**Stop and report** (do not edit) if:

- Task requires touching another active agent's ownership area without coordination
- Expected file is not where the prompt says it is
- Feature cannot be tested from the current branch
- Unrelated lint/test failure blocks validation and cannot be trivially explained
- Conflict resolution is uncertain

#### Build Mode

- Implement only after the plan is written and reviewed.
- Keep changes focused — do not broaden scope.
- Do not perform broad formatting across unrelated files.
- Do not rename public APIs or shared types unless the task explicitly requires it.
- Do not delete another agent's work to make conflicts disappear.

#### Verify Mode

Before reporting complete, agents must run all required validation.
Reports must distinguish:

| Status                             | Meaning                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| Verified in running app            | Observed behavior in the actual Tauri/Next.js application.            |
| Expected but not manually verified | Automated checks pass, but visual/runtime behavior was not observed.  |
| Blocked / unable to verify         | Cannot test due to environment, permissions, or missing dependencies. |

Do not claim runtime or UI behavior works unless observed in the running app.

---

### Definition of Done

An agent may only report **complete** if **all** of the following are true:

1. The code compiles (`tsgo --noEmit` passes with zero errors).
2. Lint passes without filtered output (`biome check .` passes with zero errors and zero warnings).
3. Relevant tests pass (`vitest run` without grep, tail, findstr, or any output filters — see [No Filtered Validation](#no-filtered-validation)).
4. The feature was manually verified in the running app when UI/runtime behavior is involved.
5. The report includes **every** item below. No omissions allowed:
   - exact files changed
   - root cause (for fixes) or motivation (for features)
   - implementation summary
   - validation commands and results (raw, unfiltered)
   - manual verification result (use only the exact phrases listed below)
   - known limitations
   - `git status --short`

**Verification phrases.** Do not use phrases like "should work," "appears to work," "looks correct," or "builds without errors" as verification. Use only:

- `Verified in running app`
- `Not verified`
- `Blocked by ...`

If none of the three required phrases apply to a manual-verification line, do not report complete — stop and resolve the ambiguity first.

---

### No Filtered Validation

Agents must not hide lint or test errors with `grep`, `findstr`, `tail`, `Select-String`, or similar filters when reporting validation. Filtered validation hides real problems and produces incorrect completion reports.

**Bad (will cause incorrect reports):**

```bash
pnpm lint | grep -v error
pnpm lint | tail -5
pnpm.cmd --filter @readest/readest-app lint 2>&1 | Select-String -NotMatch error
pnpm test 2>&1 | Select-String -Pattern "pass"
```

**Good (report raw output):**

```bash
pnpm.cmd --filter @readest/readest-app lint
pnpm.cmd --filter @readest/readest-app exec vitest run <test-file>
```

Report the full, unfiltered outcome. Pre-existing failures must be acknowledged, explained, and never hidden.

**Reason:** Filtered validation caused bad reports (e.g., "pre-existing liveMarker error") while hiding real TypeScript/lint problems. Agents must report raw validation results, not filtered summaries.

---

## Audiobook Sync Auto-Debug Rule

For audiobook sync/highlight tasks, agents must not report complete from lint/tests alone.

Before completion, the agent must provide a runtime sync diagnostic summary covering:

- marker attempts
- applied markers
- retries
- wrong-section count
- no-href count
- phrase-only fallback count
- word-window success count
- average highlighted word count
- first-play behavior
- remaining repeated error pattern

If logs show repeated `WRONG SECTION`, `section has no href`, `target section has no href`, `Word-window skipped`, or `needsRetry: true`, the task is **not complete**.

The report must use one of:

- `Verified in running app`
- `Not verified`
- `Blocked by ...`

Do not hide sync failures by only changing log levels.

---

### Branch Safety Rules

- Work only on the current branch.
- Before editing, inspect `git status --short`.
- Do not modify files outside task scope unless absolutely necessary.
- If a needed change touches another agent's ownership area, stop and report.
- Do not perform broad formatting across unrelated files.
- At the end of every task, provide `git status --short` and the list of changed files.

---

### Merge Safety Rules

- Rebase or merge from dev/integration only when instructed.
- Resolve conflicts conservatively — prefer `git checkout --theirs` or `--ours` only when certain.
- Never delete another agent's work to make conflicts disappear.
- If conflict resolution is uncertain, stop and report the conflict with file paths.

---

### Verification Script

A reusable validation script is available:

```powershell
.\scripts\validate-citadel.ps1 -Area sync     # Audiobook sync tests + lint
.\scripts\validate-citadel.ps1 -Area visual   # Lint + visual checklist
.\scripts\validate-citadel.ps1 -Area reader   # Lint + reader checklist
.\scripts\validate-citadel.ps1 -Area full     # All automated + checklists
```

See [docs/VALIDATION_CHECKLISTS.md](../docs/VALIDATION_CHECKLISTS.md) for detailed checklists per area.
