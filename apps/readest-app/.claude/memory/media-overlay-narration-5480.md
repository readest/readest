---
name: media-overlay-narration-5480
description: "PR #5480 EPUB 3 Media Overlays narration MERGED; architecture map + 3 minor review findings left unfixed (preload TOCTOU race, RTL page-follow, skip-navigation hop)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c46eb2fb-779e-451f-8ab7-137974cf360c
  modified: 2026-08-04T04:36:35.000Z
---

PR #5480 (closes #3924) MERGED 2026-08-04: books with EPUB 3 Media Overlays play their own recorded narration through the existing Read Aloud stack. All logic in `src/services/tts/mediaOverlay/` (parseSmil → MediaOverlaySection → MediaOverlayTTS → MediaOverlayClient); marks are section-global par ordinals, so marks↔clips are 1:1 with no text-to-audio alignment.

Key facts not obvious from the code:
- foliate-js needed NO changes: it already exposes `section.mediaOverlay`, `book.loadText/loadBlob`, and `book.media` (camelCased `media:*` meta incl. narrator/duration). The Tauri native EPUB bridge drives the same foliate `EPUB.init()`, so narration/badge work on that path too.
- `TTSClient` widenings: `TTSCapabilities.continuousTimeline` (skip controller paragraph gap) and `stop(handover?)` (stay rolling between utterances). `mediaClock` capability now gates timeline/`getPlaybackInfo` instead of `=== ttsEdgeClient`.
- Per-book `viewSettings.ttsUseNarration` (default true) is separate from `ttsVoice` because ttsVoice inherits the global default and can't distinguish "never chose" from "chose synthetic".
- `Book.hasNarration` is derived on import, NOT synced; books imported pre-#5480 show no headphones badge until re-imported.

Minor review findings left UNFIXED at merge:
1. Preload TOCTOU: `MediaOverlayClient.speak` preload guard `!this.#audio` is checked pre-await; a concurrent preload for a different audio file can revoke the element under active playback. Fix: also require `!this.#audioLoad`.
2. RTL/vertical page-follow: `isBeyondPage` (useTTSControl) and `isSoundingSentenceOnScreen` assume off-page content at coords >= `renderer.end`; in RTL pagination follow silently never fires (benign degrade).
3. `#initTTSForSection` calls `onSectionChange` (navigates view) before discovering an advertised overlay's SMIL is unusable, so the view can visibly hop through a skipped section.

iOS Tauri Now Playing unverified; #3924's cloud-sync/KOReader parity asks are still open. Real-EPUB e2e suite is opt-in: `READEST_MO_EPUB=<path> pnpm test media-overlay-real-epub` (W3C moby-dick-mo.epub). Related: [[tts-listening-counts-as-reading-stats]], [[edge-tts-baked-silence-ios-native-5414]].
