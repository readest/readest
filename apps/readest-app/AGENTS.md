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
pnpm format                # Biome formatter (runs from monorepo root)
pnpm format:check          # Check formatting without writing (Biome)

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

### Design System

UI/UX rules — surface tiers, action vocabulary, settings primitives (`BoxedList`, `SettingsRow`, `SettingsSwitchRow`, `SettingsSelect`, `NavigationRow`, `Tips`, etc.), boxed-list anatomy, RTL conventions, e-ink overlay, and anti-patterns — live in [DESIGN.md](DESIGN.md). Codify recurring decisions there so they persist for the team and future contributors. Reach for the primitives in `src/components/settings/primitives/` instead of inlining chassis classes.

### E-ink mode

Every new UI widget must look right under `[data-eink='true']`. E-ink screens have no shadows, no gradients, slow refresh, and need crisp 1px borders for delineation. The conventions live in `src/styles/globals.css` — reuse the existing classes instead of inventing new ones:

- **Surfaces / inputs** — add `eink-bordered`. In eink mode it swaps to `bg-base-100` + 1px `base-content` border. Use it on inputs, custom button backgrounds, ghost-styled cancel buttons, and any container that needs a visible boundary.
- **Primary action buttons** — add `btn-primary` (alongside whatever Tailwind classes you use for color themes). The `[data-eink] .btn-primary` rule inverts to `base-content` bg + `base-100` text so the primary CTA stays distinct from secondary actions.
- **`.modal-box`** picks up no-shadow + 1px border automatically; dialogs that use it don't need additions.
- **Don't rely on color/shadow alone for hierarchy.** Two same-tone buttons differ only by hover on color themes, and hover doesn't exist on e-ink touchscreens. Pair a borderless ghost (cancel) with a solid CTA (submit) so eink can invert one without flattening the difference.

When in doubt, toggle E-ink in Settings → Misc and check. The rules in `globals.css` cover most cases automatically, but composite components (custom buttons, layered cards) often need `eink-bordered` on the right element to stay legible.

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
