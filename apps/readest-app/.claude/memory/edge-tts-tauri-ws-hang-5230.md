---
name: edge-tts-tauri-ws-hang-5230
description: "#5230 Edge TTS stalls mid-book on Android: Tauri WS transport never settled on Close/error/silence; static inflight map poisoned the sentence until app restart"
metadata: 
  node_type: memory
  type: project
  originSessionId: d0e05b24-2699-47c0-9b06-219310e5c912
  modified: 2026-08-06T09:12:02.905Z
---

**#5230 "TTS player keeps pausing inexplicably" (Android, Edge TTS).** MERGED #5534 (2026-08-06) in `src/libs/edgeTTS.ts` (`#fetchEdgeSpeechWs` Tauri branch) + `src/__tests__/libs/edgeTTS-tauri-ws.test.ts`. Ask issue reporters (Pixel 7 user hit it most) to retest on the next release. **Xiaomi-13-verified** (dev-android build, CDP-driven): session 2→3 handover (the exact repro wedge point) completed in 68ms; a live `connection not found` transient was absorbed by retry 1/3; 37s of forced airplane-mode showed every synthesize rejecting fast (`Connection reset by peer`), cached sentences still playing, uncached ones skipping, then the designed clean stop (TTS bar fully dismissed, no phantom 'playing'); restart after network restore played normally. Verification harness: scratchpad `tts-verify.mjs` — adb-forward WebView CDP, hook console into `window.__ttsLog`, dispatch `t` keydown (the toggle-TTS shortcut binds on window), poll+grep.

**Root cause:** the Tauri branch only handled `Text`/`Binary` messages. tauri-plugin-websocket delivers a server close as `{type:'Close'}` and a connection read error as a **bare string** (its Rust `impl Serialize for Error` — no `type` field). Edge closing without `turn.end` (routine on mobile networks) left the synthesize promise pending forever: `#synthesizeWithRetry` retries only on rejection, `TTSController.#speak` hung awaiting `preloadSSML` with `state='playing'` (controls wedged; pause/play dead). Log signature: `[TTS] speak` with no following `[TTS] session N start`.

**Why it looked content-specific:** `EdgeSpeechTTS.inflight` is a *static* map keyed by payload hash; the stuck promise was never cleared, so every retry of that sentence — even from a fresh TTSController — joined the dead promise until app restart. A one-off transient failure therefore masqueraded as a reproducible per-sentence stall ("must skip the botched sentence").

**Fix pattern:** every exit path must settle — `settle()` guard + reject on `Close` message, on string (read-error) message, and on 30s inactivity (`WS_INACTIVITY_TIMEOUT_MS`, catches half-open sockets after network handover; frames stream continuously so silence = dead socket). Ping/Pong only refresh the timer. Rejection semantics matter: `'No audio data received.'` (turn.end, zero bytes) maps to `SpeechSynthesisPermanentError` = skip immediately, no retry; any other message = retryable (3 attempts, then chunk-skip under `MAX_CONSECUTIVE_SKIPS`).

**Test gotchas:** an async helper that `return promise` gets the promise **adopted** by `await helper()` — a never-settling promise hangs the test silently; return `{promise}` instead. The transport awaits a dynamic import + `crypto.subtle.digest`, so tests must flush macrotasks (`setTimeout 0` / `vi.advanceTimersByTimeAsync(0)`), not just microtasks.

**Unfixed neighbors:** browser branch has a narrower hole (clean close with partial audio but no turn.end → never settles); `genSSML` doesn't XML-escape interpolated text. Related: [[edge-tts-baked-silence-ios-native-5414]], [[tts-listening-counts-as-reading-stats]].
