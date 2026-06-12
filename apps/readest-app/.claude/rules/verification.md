## Verification (done-conditions)

Before marking work complete, all applicable checks must pass:

1. `pnpm test` — unit tests (vitest)
2. `pnpm lint` — Biome + tsgo (web only)
3. `pnpm lint:lua` + `pnpm test:lua` — koplugin LuaJIT syntax check + busted unit tests for `apps/readest.koplugin/spec/` (only when koplugin Lua files changed; soft-skip when luajit/busted not installed)
4. `pnpm fmt:check` — Rust format check (only when `src-tauri/` files changed)
5. `pnpm clippy:check` — Rust lint (only when `src-tauri/` files changed)
6. `pnpm test:rust` — Rust unit tests (`cargo test -p Readest --lib`; only when `src-tauri/` files changed); also run in the CI `rust_lint` job
