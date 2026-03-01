## Project Overview

Readest is a cross-platform ebook reader built as a **Next.js 16 + Tauri v2** hybrid app. It's part of a pnpm monorepo at `/apps/readest-app/`. The app runs on web (CloudFlare Workers), desktop (macOS/Windows/Linux via Tauri), and mobile (iOS/Android via Tauri).

## Common Commands

```bash
# Development
pnpm dev-web              # Web-only dev server (no Rust compilation needed)
pnpm tauri dev             # Desktop dev with Tauri (compiles Rust backend)

# Building
pnpm build                 # Build Next.js for Tauri
pnpm build-web             # Build Next.js for web deployment

# Testing
pnpm test                  # Run all tests (vitest + jsdom)
pnpm test -- src/__tests__/utils/misc.test.ts  # Run a single test file
pnpm test -- --watch       # Watch mode

# Linting & Formatting
pnpm lint                  # ESLint
pnpm format                # Prettier (runs from monorepo root)
pnpm format:check          # Check formatting without writing

# Rust
pnpm clippy                # Lint Rust code (src-tauri)
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

## Project Rules

### TypeScript

- Never use the `any` type. Use `unknown`, proper types, or generics instead.
- Strict mode is enabled. Target is ES2022.
- Unused vars prefixed with `_` are allowed (ESLint configured).

### Build Constraints

- No optional chaining (`?.`) in build output — verified by `check:optional-chaining`.
- No lookbehind regex in build output — verified by `check:lookbehind-regex`.
- Run `pnpm build-check` (builds both targets + runs all checks) before submitting.

### Safe Area Insets

See [docs/safe-area-insets.md](docs/safe-area-insets.md) for rules on handling top/bottom insets for UI elements near screen edges.
