---
name: dict-popup-tts-speak-4876
description: "Dictionary popup speaker button pronounces the headword via Edge TTS (#4876), with a standalone pronouncer that bypasses TTSController"
metadata: 
  node_type: memory
  type: project
  originSessionId: 98d0ef1c-84c2-4a16-85a0-0abad0010923
---

Issue #4876: add a "speak" button to the dictionary popup so a looked-up word
can be pronounced. Implemented on branch `feat/dict-popup-tts` (commit
f2acafb4b, 2026-07-06). Button-only (no auto-speak); speaker icon sits inline
left of the headword in the shared `DictionaryResultsHeader`, so it covers both
the desktop `DictionaryPopup` and mobile `DictionarySheet`.

Key file: `src/services/tts/wordPronouncer.ts` — a standalone single-word
pronouncer, deliberately independent of the reader's `TTSController`:
- **Speak ASAP**: never calls `EdgeTTSClient.init()` (which wastes a round trip
  synthesizing "test"). Calls `EdgeSpeechTTS.createAudioData()` directly; its
  static LRU MP3 cache makes repeat words instant.
- **Dedicated Web Audio context** (`new WebAudioPlayer(() => new AudioContext())`,
  NOT the module-shared context the reader uses) so pronouncing a word can never
  resume/suspend or overlap an active read-aloud session. One extra AudioContext,
  fine under WebKit's ~4 cap.
- **Gesture warmup**: `warmWordAudio()` must be called synchronously in the click
  handler (the hook's `speakWord` does this) because `pronounceWord` resumes the
  context only after a network await, outside WebKit's autoplay gesture window.
- **Engine order**: Edge wss -> Edge https proxy (`fetchWithAuth`, throws "Not
  authenticated" when logged out) -> platform fallback. Fallback reuses the
  existing `WebSpeechClient` (desktop/web) / `NativeTTSClient` (mobile app)
  standalone via `genSSMLRaw(word)` + `setPrimaryLang(lang)`; the SSML default
  `xml:lang="en"` is overridden by `parseSSMLMarks(ssml, primaryLang)`.
- `requestToken` guards staleness so a superseded in-flight synth bails.

Hook: `useDictionaryResults` gained `isSpeaking` + `speakWord`; cancels on word
change / unmount. Voice pick = `TTSUtils.getPreferredVoice('edge-tts', lang)`
then first `isSameLang` match then `en-US-AriaNeural`.

Tests: `src/__tests__/services/tts/wordPronouncer.test.ts` (Edge-first / fallback
contract; jsdom has no AudioContext so `getPlayer()` returns null unless
`globalThis.AudioContext` is stubbed + `WebAudioPlayer` mocked). Speak-button
wiring test added to `DictionarySheet.test.tsx` (mocks the pronouncer module).

NOT verified live: real audio playback + iOS gesture warmup (not unit-testable).
Related: [[edge-tts-webaudio-engine]] (the WebAudio refactor that replaced the old
blob-URL `createAudio` with `createAudioData`), [[ios-instant-dict-double-popup]].
