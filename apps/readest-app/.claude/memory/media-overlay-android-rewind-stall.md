---
name: media-overlay-android-rewind-stall
description: "MERGED #6058 - EPUB3 Media Overlay narration on Android rewound a few paragraphs whenever the WebView's JS stalled; root cause is the clip-continuity window in MediaOverlayClient.speak"
metadata: 
  node_type: memory
  type: project
  originSessionId: afdf9a35-8044-404b-bd63-51db96ba7c35
  modified: 2026-09-04T15:51:48.046Z
---

User report 2026-09-04 (0.12.6, Android): an EPUB 3 Media Overlay audiobook "jumps back every 3-4 paragraphs". Repro file `~/Documents/books/issues/My Vampire System ch2251-2300 (readaloud).epub` (one mp3 + one SMIL per chapter, one `<par>` per `<p>`, 0.3 s gaps between clips, shortest clips ~5 s).

**Root cause** — `MediaOverlayClient.speak()` (`src/services/tts/mediaOverlay/MediaOverlayClient.ts`): the continuity window is `[clipBegin - CLIP_CONTINUITY_TOLERANCE_SEC, clipEnd)`. A playhead that has run *past* `clipEnd` falls outside it and is treated exactly like a scrub, so the client seeks the recording **backward** to `clipBegin` and replays paragraphs already heard.

Why 0.12.6 and Android only: block advance is a JS loop (`#waitUntil` polls `audio.currentTime` every 50 ms). Until 0.12.1 Android played Media Overlays through an HTMLAudioElement **inside the WebView**, so a stalled main thread stalled the audio too and the playhead could never outrun the cursor. 0.12.6 widened `isNativeNarrationPlatform()` from `ios` to `['android','ios']` (Audiobookshelf series #5801/#5856), putting Android on the in-process ExoPlayer, which keeps playing while the WebView is stalled or timer-throttled. Any stall longer than the next clip leaves the cursor a paragraph behind, and the next `speak()` drags the audio back to the text instead of the text forward to the audio. The 3-4 paragraph cadence is the page turn (paginator relayout + adjacent-section preload = the stall; a phone page holds 3-4 paragraphs).

**Fix** (MERGED #6058, commit cef42c907, Xiaomi-VERIFIED): `#playedPar` (last par actually ridden, kept across the per-block handover unlike `#currentPar`) + a `ranPastWhileStalled` branch — same audio file, `first.clipBegin > #playedPar.clipBegin`, playhead `>= first.clipEnd` — that skips the seek and lets the marks catch up. Strict `>` so a backward navigation and a replay of the par just heard still seek.

**Device-verification recipe (Xiaomi, [[feedback-always-verify-on-xiaomi]])** — foreground playback is CLEAN for 30+ min, so do not wait for a natural repro; force it:
- Import a book by content URI, not `file://`: `content query --uri content://media/external/file --projection _id:_data --where "_data LIKE '%name%'"` then `am start -a android.intent.action.VIEW -d content://media/external/file/<id> -t application/epub+zip -n com.bilingify.readest/.MainActivity`. It imports AND opens.
- `readest://book/<hash>?autoplay=tts` starts narration; the first autoplay after import can land on a synthesized voice, re-send it and check the console for `[TTS] Initialized narration for section N`.
- Force the stall from CDP: `const end = Date.now()+45000; while (Date.now() < end) Math.sqrt(Math.random());`
- The seek is visible in logcat as a MediaCodec flush on the narration decoder. `adb logcat -v threadtime MediaCodec:I`; the narration decoder decodes continuously (`Qin` ~270 per 5 s) and flushes only on a seek, while the media-session keep-alive `silence.mp3` decoder has its own id and flushes on a fixed 10.0 s loop — do not confuse them.

**CDP gotchas on this app**: `window.__TAURI_INTERNALS__` and its `invoke`/`postMessage` are non-writable AND non-configurable, so invoke hooks silently no-op (assignment fails in sloppy mode, and the object cannot be replaced). Some invokes go over `fetch` to `http://ipc.localhost/<command>` (hookable), but plugin commands use the wry `postMessage` bridge and are invisible. `window.ipc.postMessage` IS writable but the init script captured the original. Hooks on the `foliate-view` element (`renderer.next/scrollToAnchor`, `view.goTo`, `resolveCFI`, `relocate`) work well and survive, but the element is REPLACED on reopen/adoption — re-check a `__hooked` marker before trusting a quiet log. `curl` needs `--noproxy '*'` (the shell has `http_proxy` set).

Related: [[media-overlay-narration-5480]], [[edge-tts-baked-silence-ios-native-5414]].
