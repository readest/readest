## Verification (done-conditions)

Before marking work complete, all applicable checks must pass:

1. `pnpm test` — unit tests (vitest)
2. `pnpm lint` — Biome + tsgo (also runs `pnpm lint:lua` if luajit is installed)
3. `pnpm test:lua` — busted unit tests for `apps/readest.koplugin/spec/` (only when koplugin Lua files changed; soft-skips when busted/luajit not installed)
4. `pnpm fmt:check` — Rust format check (only when `src-tauri/` files changed)
5. `pnpm clippy:check` — Rust lint (only when `src-tauri/` files changed)
