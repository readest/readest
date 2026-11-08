# Readest Lite

readest-app's React UI on a Tauri runtime with no browser engine, for e-ink readers with 512 MB
of RAM (Kindle, Kobo). The page is a [Blitz](https://github.com/DioxusLabs/blitz) document (Stylo
CSS, Taffy layout, Parley text) scripted by QuickJS-NG and painted by cairo; Tauri's commands,
plugins, events and IPC run unchanged.

Status: a baseline. readest-app's Tauri export reaches its library page on the host in about 1.2 s
(debug build). On an emulated armv7 (QEMU, 512 MB) the same page took 25–28 s on 2026-11-07,
nearly all of it QuickJS running Readest's startup JS. Performance work comes next.

## Layout

| Path | What |
| --- | --- |
| `src-tauri/` | `readest-lite`: the Tauri app (fs + os plugins, stubs of the Readest commands its startup calls) |
| `crates/tauri-runtime-blitz/` | The Tauri runtime: web APIs (`web.js`, `dom-parser.js`), IPC and custom schemes, the event loop, painting (headless or an X11 window) |
| `crates/blitz-qjs-script/` | The DOM for QuickJS: Rust ops on Blitz nodes + a JS bootstrap; bytecode cache; `qjs-precompile` |
| `crates/anyrender_cairo/` | Blitz's painter on cairo/pixman (vello_cpu has no armv7 SIMD) |
| `src/` | Node tests of the runtime's JS (`dom-parser.test.js`) |
| `patches/` | Readest's patches to the upstream code in `vendor/` |
| `vendor/` | Built by `scripts/vendor.sh`, gitignored: the patched upstream code, and web-streams-polyfill (npm) that the runtime embeds |

It is its own Cargo workspace, excluded from the repository's: Lite uses cairo-rs 0.22, Readest's
Tauri build reaches cairo-sys-rs 0.18 through GTK, and both declare `links = "cairo"`.

## Build and run

```sh
cd apps/readest-lite
scripts/vendor.sh                     # vendor/ = upstream at pinned versions + patches/
scripts/build-frontend.sh             # dist/ = readest-app's export + QuickJS bytecode
cargo run                                          # headless (frames with BLITZ_TAURI_OUT)
BLITZ_TAURI_WINDOW=1 cargo run --features window   # in a desktop window
```

`scripts/build-frontend.sh` runs `pnpm build` in readest-app first; `SKIP_APP_BUILD=1` reuses an
existing `apps/readest-app/out`. Use a scratch `HOME` for test runs: the app reads and writes
Readest's data directories under it.

After editing anything under `vendor/`, `scripts/vendor.sh diff` rewrites `patches/`.

Tests for `src/`: `node --test apps/readest-lite/src/*.test.js` (from the repository root).

## Runtime switches

| Variable | Effect |
| --- | --- |
| `BLITZ_TAURI_WINDOW=1\|gray` | Show frames in an X11 window (feature `window`); clicks, wheel and arrow keys are input |
| `BLITZ_TAURI_OUT=DIR` | Write each frame as `DIR/<label>-NNN.pgm` |
| `BLITZ_TAURI_SIZE=WxH`, `BLITZ_TAURI_SCALE` | Viewport in device pixels (default 1236x1648, a Paperwhite 5) and scale (2.5) |
| `BLITZ_TAURI_TAPS="x,y;#sel"`, `BLITZ_TAURI_TAP_MS` | Scripted taps (CSS px or a selector), one per painted frame |
| `BLITZ_TAURI_EVAL=file.js`, `BLITZ_TAURI_EVAL_MS` | Evaluate a probe script after a delay |
| `BLITZ_TAURI_INIT=file.js` | Evaluate a script before the page's scripts |
| `BLITZ_QJS_PROFILE=FILE` | Sample the running JS stack (at most once a millisecond) into FILE |
| `BLITZ_TAURI_QJS_CACHE=DIR\|off` | Local bytecode cache (default `$HOME/.cache/tauri-runtime-blitz/qjs`) |
| `BLITZ_QJS_SHIPPED=off` | Ignore shipped `.qjsc` bytecode (for stacks with file and line) |
| `BLITZ_FONTS=DIR` | Bundled fonts instead of fontconfig |
| `BLITZ_TAURI_TRACE_FETCH`, `BLITZ_TAURI_TRACE_LOOP` | Trace IPC/fetch and slow event-loop turns to stderr |

Timings go to stderr as JSON lines (`navigate`, `frame`, `tap`).
