---
name: bookdrop-cue-priming-rang-on-reader-open-6271
description: "#6271 macOS rang when opening the reader — LocalSend cue PRIMING played every cue on the first pointerdown; priming was never needed (wry enables autoplay). MERGED #6277."
metadata: 
  node_type: memory
  type: project
  originSessionId: 0906336d-a343-45b8-9f91-f732358c57da
  modified: 2026-09-18T15:25:50.208Z
---

**#6271** (opened ~2026-09-18): on macOS, opening the reader page played a ring.
Nothing was transferring.

Root cause was **not** a cue firing on a wrong event — it was the autoplay
*unlock* trick. `primeTransferCues()` in `src/services/localsend/sounds.ts`
listened for the first `pointerdown` **anywhere in the window** and played all
three cue files (`start`/`done`/`fail`) "muted" to satisfy webview autoplay
policy. Tapping a book to open the reader **is** that first gesture, and the
muted-then-unmute dance is audible on macOS WKWebView.

**Priming was never needed on any Readest platform.** wry sets
`WebViewAttributes::autoplay = true` by default → macOS/iOS get
`mediaTypesRequiringUserActionForPlayback = []`, Android gets
`setMediaPlaybackRequiresUserGesture(false)`. A Tauri webview plays programmatic
audio without a gesture. Any future "unlock audio on first gesture" code in this
app is dead weight *and* a ring waiting to happen.

Fix **MERGED #6277** (squash `8681c925f`, chrox, same day — merged ~6 min after
opening, so treat a review on a small PR here as a race): delete priming,
delete the `start` and `fail` cues and their `.wav` assets, collapse the module
to one `playTransferDoneCue({ eink })`. Failed / auto-accepted receives keep
toast + haptic, no sound. Same PR flipped `isLocalSendEnabled()` to default
**on** (`!== 'false'`) — note the old comment's warning, still true: first launch
now spends the iOS Local Network prompt and macOS firewall dialog, and an iOS
decline is sticky.

Verification recipe that actually proves silence, without hearing anything:
the cue is a plain `<audio src="/assets/...">`, so **a sound that plays leaves an
HTTP request in the Next dev server log**. Open the reader, then
`grep '\.wav' <next dev stdout log>` — zero hits means no cue was constructed.
(Watch for your own `curl` probes in that same log; check line order.)

CodeRabbit's one nitpick was real and reproduced: the cue element is a
module-level singleton, so the test asserting on its construction passed only
while it was the first to play. Follow-up PR #6279 resets the module per test.

See [[localsend-devicePrefs-per-device-not-synced]] and
[[computer-use-tauri-dev-binary-no-bundle-id]].
