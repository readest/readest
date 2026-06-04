## Project Overview

Readest is a cross-platform ebook reader built as a **Next.js 16 + Tauri v2** hybrid app. It's part of a pnpm monorepo at `/apps/readest-app/`. The app runs on web (CloudFlare Workers), desktop (macOS/Windows/Linux via Tauri), and mobile (iOS/Android via Tauri).

This local fork's purpose is to adapt the existing Readest app for local use by localizing the experience and simplifying the product surface. Prefer changes that make the app more usable in the local environment, reduce unnecessary upstream complexity, and keep the resulting build practical to test on local devices. Do not treat this fork as a general-purpose upstream feature branch unless the user explicitly asks for upstream-compatible work.

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

### Windows Android APK Build Strategy

When an agent needs to build an Android APK on this Windows workspace, use the known-good JDK 17 + Gradle 8.14.5 flow below. Prefer rebuilding the Tauri/Next frontend assets first so APKs include the latest React/Next changes.

- Use JDK 17 for Android/Gradle work. Do not use the machine's JDK 25 for this project.
- Add the local Cargo bin and Gradle 8.14.5 bin to `PATH`, and set `RUSTFLAGS` to use the Android stub libs before invoking the build.
- The generated Android project under `src-tauri/gen/android` is intentionally patched with root Gradle files, `buildSrc`, AndroidX Gradle properties, strings, and launcher icon resources. If Tauri regeneration removes those files, restore the checked-in versions before building.
- `next.config.mjs` should keep `experimental.turbopackFileSystemCacheForBuild` disabled. On this Windows workspace, enabling that beta cache has caused Next 16/Turbopack production builds to panic while processing CSS modules.
- First rebuild the Tauri frontend assets:

```powershell
pnpm --filter @readest/readest-app build-tauri
```

- Then run Gradle directly for Android APK packaging:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$env:Path=$env:JAVA_HOME + '\bin;C:\Users\PC\.cargo\bin;I:\gradle-8.14.5-bin\gradle-8.14.5\bin;' + $env:Path
$env:RUSTFLAGS='-L native=J:\script\Readest_mod\android-stub-libs'
gradle.bat --project-dir J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android assembleUniversalDebug
gradle.bat --project-dir J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android assembleUniversalRelease
```

The expected APKs are:

```text
J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk
```

Install it with:

```powershell
adb install -r J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
```

#### Local release signing

Release signing is controlled by `src-tauri/gen/android/keystore.properties`. If that file exists, `app/build.gradle.kts` automatically applies the `signing` config to debug and release builds; release output should be `app-universal-release.apk`. If it is missing, Gradle will produce an unsigned release APK such as `app-universal-release-unsigned.apk`, which is not suitable for direct installation or distribution.

This local workspace currently uses:

```text
J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\release-key.jks
J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\keystore.properties
```

Do not delete or casually regenerate `release-key.jks`. Android treats the signing certificate as part of the app identity: future APKs must be signed with the same keystore to upgrade over an existing install of `com.bilingify.readest.local`. If the keystore is lost or replaced, users will usually need to uninstall the old app before installing the new one, which also risks local app data depending on device backup/settings.

After building release, verify signing with:

```powershell
& "I:\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs "J:\script\Readest_mod\apps\readest-app\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk"
```

Expected result includes `Verifies` and `Verified using v2 scheme ... true`.

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

## Agent Workspace

Project-related agent context lives under `.agents/`, which is a symlink to `.claude/`. Treat `.agents/` as the canonical path when looking for or updating local agent material:

- `.agents/memory/` — persistent project memory and recurring context
- `.agents/plans/` — active or archived implementation plans
- `.agents/rules/` — project rules for test-first work, TypeScript, verification, and related workflows

## Project Rules

Rules are in `.agents/rules/`: test-first, typescript, verification.

### Implementation Scope

For every coding task, write the minimum code that solves the requested problem.

- Do not add features beyond what was asked.
- Do not add abstractions for single-use code.
- Do not add flexibility or configurability unless requested.
- Do not add error handling for impossible scenarios.
- If a solution is much longer than necessary, simplify it before finishing.
- Before shipping, ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

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
