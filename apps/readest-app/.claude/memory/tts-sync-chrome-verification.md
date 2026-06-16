---
name: tts-sync-chrome-verification
description: Edge TTS DOES work in the claude-in-chrome browser (WebSpeech errors there); recipe to verify TTS-driven features live + the cross-realm CFI bug it exposed
metadata: 
  node_type: memory
  type: reference
  originSessionId: c39202b7-d8c2-4150-a618-c31857a8ad73
---

Verifying TTS-driven reader features (RSVP/paragraph follow, #3235) live in the
`claude-in-chrome` (GStack) browser on `pnpm dev-web` (localhost:3001):

- **Edge TTS WORKS in claude-in-chrome.** Earlier assumption that "TTS can't run
  in the automated browser" is WRONG. Select an **Edge voice** and read-aloud
  plays + emits per-word boundaries. Verified: RSVP followed the spoken word at
  **~171 wpm** (natural audio pace, not the 300-wpm self-timer).
- **WebSpeech, by contrast, errors** there: `InvalidStateError: Transition was
  aborted because of invalid state` (no system voices / autoplay). So if TTS
  "does nothing" in chrome, the engine is WebSpeech — switch to Edge to test.
- The `readaloud` endpoint UA gate (Edg, non-headless) noted in
  [[edge-tts-word-highlighting-4017]] did NOT block it here on dev-web.

**Synthetic-CFI debug recipe (no audio needed)** — how the #3235 sync bug was
found: temporarily expose the live controller (`window.__rsvpDebug = { controller,
view, bookKey }` in the `isActive` effect), enter RSVP, then in the page:
`cfi = view.getCFI(word.docIndex, word.range); controller.syncToCfi(cfi)` for a
few words and assert `currentState.currentIndex` lands on that word. This drives
the real CFI→range path with real iframe Ranges without needing TTS audio.

**The bug it exposed (#3235):** RSVP/paragraph "follow TTS" silently never
advanced. Root cause = the cross-realm `instanceof Range` pitfall
([[iframe-cross-realm-instanceof]]): `view.resolveCFI(cfi).anchor(doc)` returns a
Range from the **book iframe's realm**, so `anchor instanceof Range` (top realm)
is always false → `resolveCfiToRange`/`applySyncCfi` returned null → `syncToCfi`
false → frozen. jsdom is single-realm so unit tests passed but it died in-app.
Fix = `isRangeLike()` duck-type (`cloneRange` is unique to Range) in
`src/utils/range.ts`, used at all 4 CFI-resolution sites (RSVPController +
useParagraphMode). See [[tts-browser-e2e-harness]] for the e2e harness.
