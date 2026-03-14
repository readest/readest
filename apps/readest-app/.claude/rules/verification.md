## Verification (done-conditions)

Before marking work complete, all applicable checks must pass:

1. `pnpm test` — unit tests
2. `pnpm lint` — ESLint
3. `pnpm fmt:check` — Rust format check (only when `src-tauri/` files changed)
4. `pnpm clippy:check` — Rust lint (only when `src-tauri/` files changed)
