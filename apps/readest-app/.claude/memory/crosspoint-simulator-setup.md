---
name: crosspoint-simulator-setup
description: "Where the CrossPoint firmware + desktop simulator + E2E harness live on this Mac, how to build/run/drive them, and every local patch needed on macOS 15 for firmware develop (SD plugins)"
metadata:
  node_type: memory
  type: project
  originSessionId: 6b8d3a47-abd0-4891-bb93-5e24bcc3b617
  modified: 2026-10-01T19:00:07.484Z
---

Checkouts under `~/dev/crosspoint/` (updated 2026-10-02):
- `crosspoint-reader/` — SHALLOW clone, branch `sim/develop` = origin/develop 664528b (SD plugins merged
  2026-09-30) + local commit "parse CSS floats with strtod on macOS < 26 hosts" (CssParser
  `tryParseNumber`: `#if SIMULATOR && __APPLE__` + `if constexpr (is_floating_point)` strtod, `from_chars`
  in the ELSE branch). The simulator sample's `-D_LIBCPP_DISABLE_AVAILABILITY` only moves the failure:
  it compiles, then **dyld aborts at launch** (`__from_chars_floating_point` missing before macOS 26).
- Untracked `crosspoint-reader/sim-shims/` (+ `-Isim-shims` in `platformio.local.ini`): re-exports SDK
  `Crypto.h`/`Util.h`, fail-closed `WolfsslCrypto.h` + `wolfssl/wolfcrypt/aes.h` for `/api/crypto`.
- `platformio.local.ini` (gitignored) = simulator `sample-platformio-macos.ini` with
  `simulator=symlink://../crosspoint-simulator`, pre-script `../crosspoint-simulator/skip_device_content_protection.py`
  (the sample's `.pio/libdeps/...` path does not exist for symlink deps), `-Isim-shims`,
  `-DARDUINOJSON_ENABLE_ARDUINO_STRING=1` (WString.h only sets it when included before ArduinoJson).
- `crosspoint-simulator/` — branch `readest-e2e-fixes` (9dca0e2 on 20e7380): String begin/end, WebServer
  protected `_currentArgs/_postArgs`, `HalGPIO::getFactoryMac`, `<sys/time.h>` in Arduino.h, and
  **HTTPClient::begin clears headers**, and (2026-10-02) **SecureHttpClient::sendRequest passes ANY method** (it mapped everything but POST/PUT to GET, so relayed DELETEs silently became GETs) (else a reused session resends the previous Authorization header —
  device SecureHttpClient::begin clears `_headers`). All upstream-worthy.
- Firmware branch `sim/pr3424` = sim/develop + PR #3424 (precise KOSync anchors) for interop checks.
  Deterministic boot: set `lastSleepFromReader:false` in `fs_/.crosspoint/state.json`, then BACK on Home
  resumes the most recent book. Reader menu "Sync Progress" = 11th item (RIGHT x10) unless a bookmark exists
  (adds "Bookmarks", shifting it). Vitest console output needs `--silent=false --reporter=verbose`.
- `e2e/sim.sh <run> '<ms:KEY;...>' '<ms:shot;...>' [timeout]` runs headless, writes 360px PNGs to
  `crosspoint-reader/qa-artifacts/<run>/`. `e2e/fake-readest.mjs` = protocol double of `/api/crosspoint/*`
  (device code + `POST /__approve` hook, books, download hop, `/r2/`, sessions, KOSync), logs `requests.jsonl`.
  Install the plugin on `fs_/.crosspoint/plugins/readest/` with `https://web.readest.com` sed-replaced by
  `http://127.0.0.1:8787`.

**Traps:** shell exports `http_proxy`/`https_proxy`; the proxy swallows loopback, and the simulator shells
out to host `curl` — run it with `NO_PROXY=127.0.0.1,localhost` (sim.sh does) and use `curl --noproxy '*'`.
Home menu on develop: resume card, Browse Files, Library, Plugins (only when a plugin is installed), File
Transfer, Settings; LEFT/RIGHT = Up/Down, BACK on Home = Resume. After a SLEEP from a book the next boot
resumes INTO the book. Plugin catalog asks for Wi-Fi first (ENTER on "Simulator WiFi (fake)"). The open
fake network saves no credential, so sleep-time event drain never brings Wi-Fi up; File Transfer → join
network drains the outbox. Web UI = http://127.0.0.1:8080. Chrome: `ref` clicks on the plugin card's
buttons did not fire `onclick`; coordinate clicks did.

**Why/how to apply:** after pulling firmware or simulator, rebuild and expect new HAL/shim gaps (the
simulator lags firmware); check the CssParser commit still applies. See [[crosspoint-integration-feasibility-2026-09]].
