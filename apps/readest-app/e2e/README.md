# End-to-end tests

Readest has two end-to-end lanes. They cover different layers and are run
separately.

## Web lane — Playwright

Drives the Next.js **web** build (`pnpm dev-web`) in a real browser. Fast, no
Rust build required. Tests run unauthenticated against a fresh browser
context, so each test starts from an isolated, empty local library.

```bash
pnpm test:e2e:web          # run the web e2e suite (auto-starts pnpm dev-web)
pnpm test:e2e:web:ui       # run in the Playwright UI mode
pnpm test:e2e:web:report   # open the last HTML report
```

Layout:

| Path                              | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| `playwright.config.ts` (app root) | Runner config, projects, web server.                   |
| `e2e/tests/`                      | Specs (`*.spec.ts`).                                   |
| `e2e/pages/`                      | Page Object Model — actions/queries, no assertions.    |
| `e2e/fixtures/`                   | Shared fixtures; `fixtures/books/` holds sample books. |

Page objects expose locators and actions; assertions stay in the specs so
failures point at test intent. To add coverage, prefer extending a page
object over inlining selectors in a spec.

The demo-book auto-import (`useDemoBooks`) is suppressed by the base fixture
so the library is deterministic; authenticated/sync flows are out of scope
for this lane until a test account is provisioned.

## Tauri lane — WebdriverIO

Drives the actual **Tauri** desktop shell via `tauri-driver`. Use this for
coverage that depends on the native build (Rust integration, window
management, platform globals).

```bash
pnpm tauri:dev:test        # start the Tauri app with the webdriver feature
pnpm test:e2e              # run wdio against it (specs: e2e/*.e2e.ts)
```
