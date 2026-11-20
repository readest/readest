---
name: narration-stale-load-7621
description: "#7621 a slower narration load replaced the playing clock after a skip; per-load AbortController fix MERGED #7627 (0afd365f4); dev-web Media Overlay repro recipe (generated EPUB, window.Audio wrap)"
metadata:
  node_type: memory
  type: project
  originSessionId: ab707d40-0f1f-4614-9509-1ab7acbce072
  modified: 2026-11-18T11:22:56.885Z
---

#7621 (2026-11-18): on the audio-element path, `MediaOverlayClient.#loadAudio` of file A finished after narration had skipped to B and took over the clock (Pause left B playing; the next B block built a second B element, double audio). Fix MERGED 2026-11-18 as #7627 (squash 0afd365f4, head 73eeff90e):
- `#audioLoad` carries an `AbortController`. `#leaveLoadBehind(keep?)` aborts it when:
  - a load of another file starts;
  - narration returns to a cached clock or the native rolled-into file;
  - `invalidatePlayback()` or `shutdown()` runs.
- On Linux that signal also goes to `loadSource`, and a stale native load pauses the player when it isn't narration's clock.
- A preload skips while `#audioLoad` is in flight.
- iOS and Android native loads are unchanged (no signal); native-vs-native ordering is up to the player.
- Declined: a check after multi-track `setRate`. ABS and BookOrbit `resolveTracks` ignore href (one paired file), so there's no A→B change.

**Dev-web repro recipe (Media Overlay narration, no fixture in repo):**
- Generate an EPUB 3 with python zipfile: one spine item with `media-overlay="ch_smil"`; p1 → `audio/ch1.mp3` 0-5s, p2/p3 → `audio/ch2.mp3`. ch1 = 6 s sine + 1 h `anullsrc` at 320k (144 MB, deflates to ~0.8 MB, ~1-2 s to inflate in Chromium, so `loadBlob` is slow). Must be DEFLATED: a stored entry plays from a slice and skips `loadBlob`.
- Playwright on `pnpm dev-web -p 3007` with a temp config; `addInitScript` wrapping `window.Audio` to record every element (src/paused/currentTime).
- Start with `t` over the viewer, then `page.waitForEvent('console', m => m.text() === '[TTS] speak')` before clicking Next Sentence. Clicking before init started Edge TTS instead of narration.
- Pause button: `reader.revealFooter()` first, then the `:visible` `aria-label="Pause"` button. Otherwise foliate-view intercepts. Don't open the Next.js issues overlay; it eats clicks.

Related: [[rsvp-playwright-dev-web-recipe]], [[narration-ios-file-window-6989]].
