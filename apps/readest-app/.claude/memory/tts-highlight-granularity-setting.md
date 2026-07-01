---
name: tts-highlight-granularity-setting
description: TTS highlight granularity (word/sentence) user setting and its two-point gating in TTSController
metadata: 
  node_type: memory
  type: project
  originSessionId: 33ddd196-7404-4af2-99ac-0d3b19b39b4e
---

Settings → TTS → "TTS Highlighting" boxed list has a **Granularity** select (first row, before Style): `Word` (default) / `Sentence`. Field `ttsHighlightGranularity: TTSHighlightGranularity` on `TTSConfig` (`src/services/tts/types.ts`, `src/types/book.ts`), default `'word'` in `DEFAULT_TTS_CONFIG`. UI in `TTSHighlightStyleEditor.tsx` (props `granularity`/`onGranularityChange`), persisted from `TTSPanel.tsx` via `saveViewSettings(..., false, false)` + a value-watching `useEffect` (mirrors `ttsMediaMetadata`).

Word-by-word highlighting only ever happens on **Edge TTS** (`supportsWordBoundaries() === true`); Web/Native always highlight per sentence. We assume every engine supports sentence highlighting, so picking `word` on a non-word-boundary engine naturally falls back to sentence.

**Gating lives at two points in `TTSController` (NOT one helper):**
1. `dispatchSpeakMark` suppression: `#suppressMarkHighlight = ttsClient.supportsWordBoundaries() && #highlightGranularity === 'word'`. With `sentence`, don't suppress → the sentence highlight is drawn at mark dispatch.
2. `prepareSpeakWords` early-return: `if (#highlightGranularity === 'sentence') return;` — **gated on granularity only, NOT on `supportsWordBoundaries()`**. Reason: `prepareSpeakWords` is only called by EdgeTTSClient in prod (boundaries present), but `tts-controller.test.ts` calls it directly with the *web* client active (supportsWordBoundaries=false) and expects word highlighting. Adding a `supportsWordBoundaries()` check there would break those existing tests.

Controller learns the value via `setHighlightGranularity()` (called at creation in `useTTSControl.ts` next to `updateHighlightOptions`, and from a `useEffect` on `viewSettings.ttsHighlightGranularity`). Mock `TTSController` in `useTTSControl.test.tsx` must include `setHighlightGranularity: vi.fn()` or the speak path throws and emits no position/state.

Related: [[edge-tts-word-highlighting-4017]], [[tts-word-highlight-singletextnode-drift]], [[tts-sync-paragraph-rsvp-3235]].
