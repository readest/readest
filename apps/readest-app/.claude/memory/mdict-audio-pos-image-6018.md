---
name: mdict-audio-pos-image-6018
description: "#6018 MDD dict: iOS audio dead (typeless blob + play() after await), entry://#anchor forwarded as a headword, no image zoom; all 3 Android-verified with the real OALD9"
metadata:
  type: project
---

Issue #6018 (iOS 27, Readest 0.12.6, 牛津9/OALD9 MDX+MDD) reported 3 defects. All three
fixed in `mdictProvider.ts` + `DictionaryResultsView.tsx`; `pnpm test` 10653 green.

**1. Audio dead on iOS — TWO independent WebKit failures, both already documented
elsewhere in this repo.**
- `new Blob([new Uint8Array(located.data)])` had NO MIME type. A media element refuses to
  decode a typeless blob URL ("Format error"). Precedent: `MediaOverlayClient.ts`
  `AUDIO_MIME_TYPES` / `audioBlobWithType()`. Chromium sniffs the bytes, which is why it
  only broke on iOS.
- `new Audio(url).play()` ran AFTER `await mdd.locateBytes(...)` — outside the user-gesture
  window, so autoplay policy rejects it silently. Precedent: `wordPronouncer.ts:72`
  (`warmWordAudio` MUST be called synchronously from the click handler).
- Fix = module-scoped `dictAudio` element primed with `SILENCE_DATA` **synchronously** in
  the click handler (`primeDictAudio()`), then `src` swapped to the typed blob URL after
  the MDD read. Both audio paths (`sound://` anchors AND the `v0r.v(this,'KEY')` onclick
  rewrite) needed it.
- The reporter's own MDX/MDD was later supplied locally at
  `~/Documents/books/issues/6018/OALD9EnEn.{mdx,mdd,css}` (the iCloud share link cannot be
  downloaded headlessly: `shared/records/query` -> `AUTHENTICATION_FAILED`).

**2. POS navigation — CONFIRMED by the reporter's screenshot.** The popup title read
`#cf1a266bba9044eb9f49d7171287f759` with an empty body, i.e. `onNavigate('#cf1a...')` was
called and looked the literal string up as a headword. `ENTRY_HREF_RX` stripped only the
scheme; MDict's in-entry jump is `entry://#anchor` (Oxford POS switchers use it).
Fix splits the fragment off: `entry://#frag` and bare `#frag` scroll in-entry,
`entry://word#frag` still navigates to `word`. The jump MUST be done explicitly —
the body lives in a **shadow root**, which document fragment navigation never enters.
Target lookup tries `#id` (CSS.escape) then legacy `<a name=...>`; search root is
`anchor.getRootNode()` because wiring runs BEFORE the body is moved into the shadow root.

**3. Image zoom — nothing was listening.** Fix reuses the reader's
`ModalPortal` + `ImageViewer` + `convertBlobUrlToDataUrl` (the `BookCoverViewer` recipe),
rendered from `DictionaryResultsBody` so BOTH `DictionaryPopup` and `DictionarySheet` get
it from one place (`{...state}`).
**Zooming the tapped `<img>` is NOT enough.** OALD9 ships every illustration TWICE inside
`<div class="ox-enlarge">`: a hidden 720x540 copy (`style="display:none"`) followed by the
`class="thumb"` 100x100 that is laid out, each with an inline `onclick` that swaps their
`display`. Blowing up the thumb produced a 100px image on a 393px screen - visually a
no-op. `fullResolutionSrc()` takes the largest `naturalWidth` `<img>` in the tapped image's
`closest('a') ?? parentElement`. Markup-agnostic, and a not-yet-decoded twin reports
`naturalWidth === 0` so it falls back to the tapped image. Device: 720x540 diagram, legible.

**Latent bug fixed on the way:** `handleContainerClick` used `e.target.closest('a')`, but
for MDict content `e.target` is RETARGETED to the shadow host, so http(s) links inside
MDict entries never reached `openUrl` on Tauri. Now uses `e.nativeEvent.composedPath()`
(the same idiom the card's tap-to-expand handler already used). Image handling is NOT
Tauri-gated; the external-link branch still is.

Known gaps left alone: a fragment jump inside a COLLAPSED card can't expand it (the
provider `stopPropagation()`s, so the container handler never sees the click); Escape
closes the image viewer AND dismisses the popup (both `useKeyDownActions` listeners are on
`window` — pre-existing, same for `BookCoverViewer`/`TableViewer`).

**ANDROID-VERIFIED 2026-09-02** (Xiaomi 13 `368b0948`, release APK + devtools, the real
OALD9, headword `house` - it is the rare entry that exercises all three: 4 POS, 2 imgs,
uk/us audio; find candidates with `jsmdict/pick.mts`):
1. audio - `URL.createObjectURL` blob `type:"audio/mpeg"` 15881 B, then
   `canplay -> playing -> play() resolved -> ended` 1.26 s later. The prime's own
   `play()` REJECTS with `AbortError: interrupted by a new load request` - EXPECTED, that
   is the `src` swap landing, not a failure.
2. POS - tapping `verb` moved the card `scrollTop 0 -> 3405` (of 4145) and left the sheet
   header on `house`; the `#30be98...` anchor landed 266 px down the viewport.
3. image - the zoomed `<img>` reports `naturalWidth 720`, laid out 393x295.

Verification recipe: CDP over `adb forward tcp:9223 localabstract:<webview_devtools_remote>`
(node `fetch`, NEVER `curl` - it returns empty). foliate iframes sit at shadow-DOM depth 2,
so walk `shadowRoot`s; `document.querySelectorAll('iframe')` returns `[]`. Patch
`HTMLMediaElement.prototype.play` + `URL.createObjectURL` from CDP to prove playback.
Screen 1080x2400, CSS 392x872, dpr 2.75 -> `adb shell input tap $((cssX*2.75)) ...`;
pron buttons are only 14 CSS px wide, so read their rects first instead of aiming.

Also fixed on the way: [[lookup-surface-flash-suppress-handles-6013]] - on the FIRST device
run the sheet flashed and vanished after 16 ms, a #6013 regression unrelated to this issue.

Fourth defect, spotted from the device screenshots: the source label read
`Oxford Advanced Learner&apos;s Dictionary 9th edition`. The MDX header is XML
(`<Dictionary ... Title="Oxford Advanced Learner&apos;s Dictionary 9th edition" .../>`, UTF-16LE,
length-prefixed BE uint32), and `readMdxHeader` in `services/dictionaries/dictionaryService.ts`
lifted attribute values straight out of a regex with NO entity decoding, so the name stored at
import time carried the literal entity. Fix = `decodeXmlEntities` over every attribute value
(5 predefined XML entities + numeric/hex refs, clamped at 0x10FFFF so a junk ref cannot throw and
mark the dictionary `unsupported`). Import-time only: ALREADY-imported dictionaries keep the bad
stored name until re-imported, but Settings has a rename (`updateDictionary(id, { name })`).
`dictionaryService.ts` contains a literal NUL byte (`.replace(/\x00+$/, '')`), so `file` calls it
`data` and plain `grep` reports nothing - use `grep -a`, and patch it with a byte-preserving
script, never a naive rewrite.

MERGED #6021 (211cb2b67) 2026-09-02. CodeQL caught `js/xss-through-dom` (high) on the second
commit: the resolved audio URL was cached in a `data-` attribute on the UNTRUSTED MDX body and
read back into `audio.src` (the old `new Audio(url)` had the same source, but the constructor
is not a modelled sink - moving to `.src` is what surfaced it). Fix = a `WeakMap<Element, string>`
cache, never the DOM. iOS device verify STILL PENDING (the audio half is WebKit-only).

See [[annotator-overlay-z-layers]], [[footnote-popup-double-scrollbar-5999-5998]].
