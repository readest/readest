---
name: read-aloud-selection-onetime-5011
description: Ctrl/Cmd+R "Read Aloud Selection" started a whole TTS session because handleSpeakText's oneTime param defaulted to false
metadata:
  type: project
---

Issue #5011: Ctrl/Cmd+R is documented as "reads the selection and stops" but started
reading at the top of the paragraph containing the selection and carried on through the
book. **Xiaomi-VERIFIED** on the shipped build, then fixed (PR #6076).

**ROOT CAUSE:** `Annotator.tsx` had `handleSpeakText = async (oneTime = false)` and
`onReadAloudSelection` called `handleSpeakText()` with no argument. `useTTSControl` gates
the selection-only path on `const speakSelection = oneTime && !!ttsSpeakRange`, so a false
flag fell through to `ttsController.startFromRange(ttsFromRange)` = start a session at that
block and keep going.

The selection-toolbar button (`onClick: handleSpeakText`) relied on the same default and
was correct ONLY BY ACCIDENT: React hands a click handler the MouseEvent, which is truthy.

**FIX:** pass `oneTime` explicitly and make the parameter REQUIRED so no caller can fall
into session mode silently.

**Why:** a boolean with a default that flips between "speak this once" and "start an
open-ended session" is a trap — the accidental-truthy toolbar case hid it for a long time.

**How to apply (device verification recipe for event-payload bugs):** patch
`window.CustomEvent` over CDP and record constructions of the event type you care about —
readest's `eventDispatcher` is a module-private pub/sub with no window handle, but it
builds a `CustomEvent` per dispatch, so the constructor is the seam. Then long-press
(`adb shell input swipe X Y X Y 800`) to make a real selection and dispatch the shortcut as
a REAL `KeyboardEvent` — a doctored CustomEvent with defineProperty'd `key` throws
`Cannot read properties of null (reading 'keyName')` inside `useKeyDownActions` and never
reaches `useShortcuts`.

**Still open in that thread (NOT this bug, NOT fixed):**
- iOS Quick Action "reads only the first word" of a multi-word selection. That path already
  passed `oneTime: true`, and `oneTime` speaks the WHOLE ssml (it only suppresses
  auto-advance at `TTSController.ts:1552`), so truncation is in the native iOS client.
- Commenter's Linux Flatpak Edge TTS "one word then silence, web is fine" = desktop Edge
  TTS transport, closer to [[edge-tts-tauri-ws-hang-5230]]. Deserves its own issue.
- `genSSMLRaw` interpolates selection text into SSML with NO XML-escaping, so a selection
  containing `&` or `<` makes malformed SSML. Untouched.

Related: [[tts-fixes]], [[fixed-layout-missing-primaryindex-tts-6071]]
