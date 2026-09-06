# Testing

Readest uses several test tiers. Unit, browser, Tauri integration, and Android
device tests use [Vitest](https://vitest.dev/); full Tauri UI E2E uses
WebDriverIO with Mocha.

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
- **Use for:** WASM modules (e.g. `@tursodatabase/database-wasm`), Web Worker integration such as bundled dictionary plugins, and browser-specific storage APIs.

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

## Android Device E2E (`pnpm test:android`)

Drives the **installed Readest app** on an adb-connected Android device or
emulator: gestures are injected with `adb shell input`, and the app's state is
probed through the WebView's **Chrome DevTools Protocol** (forwarded from the
`webview_devtools_remote_<pid>` abstract socket). This is the only lane that
exercises real Android touch selection, native handle behavior, and page-turn
gestures (e.g. the issue #1553 hyphen-selection fixes).

```bash
# One-time: install a dev build on the device/emulator
pnpm dev-android

# Start an emulator if no device is attached (see `emulator -list-avds`)
emulator -avd Pixel_9_Pro &

# Run the lane (soft-skips when no adb/device/app is available)
pnpm test:android

# With several devices attached, pick one:
ANDROID_SERIAL=emulator-5554 pnpm test:android
```

- **Config:** `vitest.android.config.mts` (node environment, serial execution, `retry: 1`)
- **Pattern:** `src/**/*.android.test.ts`
- **Helpers:** `src/__tests__/android/helpers/` — `adb.ts` (gestures), `cdp.ts` (DevTools client), `reader.ts` (app-level probes)
- **Fixtures:** plain EPUBs from `src/__tests__/fixtures/data/` (e.g. `sample-alice.epub`), opened transiently via a `VIEW` intent so the device library is never modified
- **Use for:** native text selection, touch gestures, selection handles, anything that only reproduces in the Android WebView compositor.

### Conventions

- **Probe, don't hardcode:** locate words/handles at runtime via CDP and derive
  device pixels from `devicePixelRatio` — never bake in coordinates.
- **Poll, don't sleep:** use `waitFor()` on an observable condition (selection
  state, handle count, frame position); reserve fixed pauses for gesture
  pacing (long-press hold, corner dwell).
- **Discover, don't assume:** the harness finds a hyphenated on-screen
  paragraph at runtime and derives every gesture target from live layout, so
  any English fixture works regardless of fonts or screen size (hyphenation
  is on by default in the app).
- **Serial only:** one device, one app — the config disables parallelism.

### CI

`.github/workflows/android-e2e.yml` runs the lane on an x86_64 emulator
(ubuntu runner with KVM): it builds a **debug** APK for `x86_64` (no signing
secrets needed), boots a cached AVD via `reactivecircus/android-emulator-runner`,
installs the APK, and runs `pnpm test:android`. It is intentionally not
PR-blocking — it runs nightly, on `workflow_dispatch`, or when a PR gets the
`e2e-android` label.

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

## Debugging the Linux CEF Build (CDP)

The Linux CEF runtime is Chromium, so the app window is a normal Chrome DevTools
Protocol target — the same interface Chrome, Playwright and Puppeteer speak. This
is the only way to inspect the running desktop app on Linux (WebKitWebDriver, used
by `pnpm tauri:dev:test`, drives the wry runtime instead).

```bash
# Terminal 1: dev build with the CDP endpoint on 127.0.0.1:9222
pnpm tauri:dev:cdp

# Terminal 2
pnpm cdp targets                                     # list debuggable targets
pnpm cdp eval 'document.title'                       # run JS in the app window
pnpm cdp eval 'window.__TAURI_INTERNALS__.invoke("plugin:app|version")'
pnpm cdp click 'button[aria-label="Import Books"]'   # real pointer events
pnpm cdp screenshot /tmp/library.png
pnpm cdp logs 30                                     # tail the app console
```

`pnpm tauri:dev:cdp` is `pnpm tauri dev` with `READEST_CDP_PORT=9222`. Any CEF
build honours that variable — a packaged `.deb`, the Flatpak, or `tauri build`
output — so the same tooling works against release binaries:

```bash
READEST_CDP_PORT=9222 readest
CDP_PORT=9222 pnpm cdp targets
```

`scripts/cdp.mjs` is dependency-free (node's global `fetch` and `WebSocket`); the
endpoint listens on loopback only. For anything richer, connect a real client to
the same port — `chrome://inspect` in a local Chrome, or
`chromium.connectOverCDP('http://127.0.0.1:9222')`.

### Limits

- **The IPC bridge cannot be stubbed.** `window.__TAURI_INTERNALS__.invoke` is
  defined non-writable and non-configurable, so assigning over it from `eval`
  fails silently and the real command still runs. You can *call* it, not fake it.
- **Native dialogs are outside the page.** The file picker is an XDG portal
  window (`org.gnome.Nautilus` on GNOME), not a CEF surface, so CDP cannot see or
  click it. Driving an import end-to-end needs X11 input (XTEST via python-xlib:
  focus the chooser, `Ctrl+L`, type the path, `Return` to select, `Return` to
  open) — or skip the picker and dispatch the app's own `import-book-files` event.
- **Passing `--remote-debugging-port` on argv works too**, but `tauri-plugin-cli`
  parses the same argv for open-with paths and warns on every launch. Prefer the
  env var.

## Test File Naming

| Suffix              | Runner              | Environment           |
| ------------------- | ------------------- | --------------------- |
| `*.test.ts`         | `pnpm test`         | jsdom                 |
| `*.browser.test.ts` | `pnpm test:browser` | Chromium (Playwright) |
| `*.tauri.test.ts`   | `pnpm test:tauri`   | Tauri WebView         |
| `*.e2e.ts`          | `pnpm test:e2e`     | Tauri app (WDIO)      |
| `*.android.test.ts` | `pnpm test:android` | Android device (CDP)  |
