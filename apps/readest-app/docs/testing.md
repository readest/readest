# Testing

Readest uses three test tiers, all powered by [Vitest](https://vitest.dev/).

## Unit Tests (`pnpm test`)

Runs tests in a **jsdom** environment. No browser or Tauri runtime required.

```bash
pnpm test                                       # Run all unit tests
pnpm test -- src/__tests__/utils/misc.test.ts   # Run a single file
pnpm test -- --watch                            # Watch mode
```

- **Config:** `vitest.config.mts`
- **Pattern:** `src/**/*.test.ts` (excludes `*.browser.test.ts` and `*.tauri.test.ts`)
- **Environment:** jsdom
- **Use for:** Pure logic, utilities, services that don't need real browser APIs or Tauri IPC.

## Browser Tests (`pnpm test:browser`)

Runs tests in a **real Chromium** browser via Playwright. Required for code that depends on Web Workers, SharedArrayBuffer, OPFS, or other browser-only APIs.

```bash
pnpm test:browser
```

- **Config:** `vitest.browser.config.mts`
- **Pattern:** `src/**/*.browser.test.ts`
- **Browser:** Chromium (headless, via `@vitest/browser-playwright`)
- **Use for:** WASM modules (e.g. `@tursodatabase/database-wasm`), Web Worker integration, browser-specific storage APIs.

## Tauri Integration Tests (`pnpm test:tauri`)

Runs Vitest tests **inside the Tauri WebView**, with access to Tauri IPC and native plugin commands. Tests execute in the actual app environment.

### Step 1: Start the Tauri App

In one terminal, start the app with the `webdriver` feature enabled:

```bash
pnpm tauri:dev:test     # Dev mode (uses tauri dev server, faster iteration)
pnpm tauri:build:test   # Debug release build (closer to production)
```

These commands compile the Rust backend with `--features webdriver`, which:

- Includes `tauri-plugin-webdriver` (embeds a W3C WebDriver server on port 4445)
- Adds a runtime capability granting plugin permissions to remote URLs (`http://127.0.0.1:*`), so Vitest's browser-mode iframe can call Tauri IPC

Keep this running while you run tests.

### Step 2: Run Tests

In another terminal:

```bash
pnpm test:tauri
```

Vitest connects directly to the embedded WebDriver server (port 4445) in the running Tauri app and executes tests inside its WebView.

- **Config:** `vitest.tauri.config.mts`
- **Pattern:** `src/**/*.tauri.test.ts`
- **Browser provider:** `@vitest/browser-webdriverio` (connects to port 4445)
- **Use for:** Tauri plugin commands (turso, native-tts, etc.), native filesystem, Tauri IPC.

### Writing Tauri Tests

Tests access Tauri IPC via a shared helper:

```typescript
import { invoke } from '../tauri/tauri-invoke';

it('calls a plugin command', async () => {
  const result = await invoke('plugin:turso|load', { options: { path: 'sqlite::memory:' } });
  expect(result).toBeDefined();
});
```

The `invoke()` helper accesses `window.top.__TAURI_INTERNALS__` (Vitest runs in an iframe, Tauri injects IPC into the main frame).

**Limitations:** Only custom invoke commands and plugin commands listed in the webdriver capability work. Standard Tauri JS APIs (e.g. `@tauri-apps/api`) that rely on `URL: local` may not work from the Vitest iframe.

## E2E Tests (WDIO)

Full end-to-end tests using WebDriverIO, for UI-level testing against the running Tauri app. Same two-step workflow as Tauri integration tests.

```bash
# Terminal 1: start the app (same as for Tauri integration tests)
pnpm tauri:dev:test

# Terminal 2: run E2E tests
pnpm test:e2e
```

- **Config:** `wdio.conf.ts`
- **Pattern:** `e2e/**/*.e2e.ts`
- **Framework:** Mocha (via `@wdio/mocha-framework`)
- **Connects to:** port 4445 (embedded WebDriver server)
- **Use for:** UI interaction tests, window management, navigation flows.

## Test File Naming

| Suffix              | Runner              | Environment           |
| ------------------- | ------------------- | --------------------- |
| `*.test.ts`         | `pnpm test`         | jsdom                 |
| `*.browser.test.ts` | `pnpm test:browser` | Chromium (Playwright) |
| `*.tauri.test.ts`   | `pnpm test:tauri`   | Tauri WebView         |
| `*.e2e.ts`          | `pnpm test:e2e`     | Tauri app (WDIO)      |
