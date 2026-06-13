---
name: edge-tts-word-highlighting-4017
description: "Edge TTS word-by-word highlighting (#4017, PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: afd9b381-c17d-4988-b287-07263d8bea0b
---

# Edge TTS word-by-word highlighting (#4017, PR #4566)

**Design: keep sentence granularity, add word highlight on top.** All clients still report `getGranularities() = ['sentence']` — switching foliate to word marks would regress media-session metadata (one word on lock screen), byMark seek (word steps), `getSpokenSentence`, and per-word synthesis. Instead: `EdgeSpeechTTS.createAudio()` returns `{url, boundaries}` (cached per payload-hash next to the blob URL), `EdgeTTSClient` runs a rAF loop syncing `audio.currentTime` (media time → playbackRate/pause-safe) against boundary ticks, and `TTSController.prepareSpeakWords/dispatchSpeakWord` match words sequentially (`indexOf` with a moving cursor; unmatched word = skip WITHOUT advancing cursor) against the sentence range text, then highlight the sub-range via the existing `#getHighlighter`.

**Edge wire facts** (verified with raw WS probe + live):
- `audio.metadata` frames: `{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":4250000,"text":{"Text":"Dr.","Length":3}}}]}` — one word/frame, ticks = 100 ns (1e7/s), offsets relative to this request's audio stream.
- `Text` is the **verbatim input span** ("Dr.", "23", "$5.50" keep punctuation; trailing sentence punctuation stripped) → sequential indexOf matching is robust. Works for zh too.
- The readaloud endpoint gates on **User-Agent (needs Edg/non-headless), NOT Origin** — a localhost Origin with Edg UA is accepted; default HeadlessChrome UA is rejected (close 1006).

**Pre-existing bug fixed in the same PR:** browser branch did `new WebSocket(url, {headers})` → native WebSocket parses the object as a subprotocol → `SyntaxError` → on web the wss path could NEVER work (always https-proxy fallback, which strips boundaries). Node-only options now.

**Probe gotchas:** Overlayer draws the highlight as a `<path>` inside `<g fill="#808080">` (NOT `<rect>` — rect-only DOM probes miss it); the overlayer svg lives in `FOLIATE-PAGINATOR`'s open shadow root (sibling layer of the iframe, not inside it). TTS auto-advance creates new views — re-query svgs per sample, never cache the list.

**dev-web live-verify recipe:** gstack `browse --proxy http://127.0.0.1:8118` (flag needed on EVERY invocation; this machine's external net needs the local proxy, headless Chromium doesn't inherit it) + `browse useragent '...Edg/143...'` (context-level, doesn't break Next) — do NOT use `browse header Origin:...` (extra headers hit localhost too → Next dev 403s ALL chunks → blank page; headers can't be removed without daemon restart). Import books via synthetic drop: fetch epub from `public/`, `DataTransfer` + `DragEvent('drop')` on `.library-page` (in-memory only — re-import after every reload/restart). Patch `content.overlayer.add/remove` to log the real highlight calls — the ground truth when screenshots race. Related: [[tts-fixes]]
