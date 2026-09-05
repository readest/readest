---
name: pdf-contextmenu-translate-android-5821
description: "#5821 PDF word selection on Android always opened the translator popup - the fixed-layout right-click handler fired on Android's long-press contextmenu; branch DELETED, MERGED 19989d272"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6609ee0b-c0cc-4039-854b-a7ee90efe036
  modified: 2026-09-05T04:59:21.070Z
---

`#5821` — "Translate box covering/obstructing definition box". On **Android, PDF (fixed
layout) only**: selecting a word opened the translator popup on top of the dictionary the
reader had actually asked for. Reporter is on GrapheneOS with all network permissions cut and
an offline MDict OED; changing translator provider or turning off Instant Translate changed
nothing, because **no setting was ever consulted**.

**Root cause.** `Annotator.tsx` `onLoad` registered, for `bookData.isFixedLayout` only, a
`contextmenu` listener that unconditionally did
`setShowAnnotPopup(false); setShowDeepLPopup(true); setShowDictionaryPopup(false)`.
Written for **desktop right-click** ("For PDF selections, enable right-click context menu to
directly open translator popup") in PR #2430 (`c4d965233`, 2025-11-11); #5828 (`a2f123ff9`)
later added the `preventDefault`. Android's WebView **also dispatches `contextmenu` for a long
press**, which is the very gesture that selects a word — so every PDF word selection forced
the translator. With Instant Dictionary on, the deferred quick action then opened the
dictionary at touchend, stacking both popups (the issue screenshot).

**Why iOS never reproduced:** WebKit dispatches **no** `contextmenu` for a long-press text
selection — it runs its own callout bar instead — so the branch was dead there. Same family as
[[longpress-contextmenu-double-fire-5596]] (one Android long press emits two independent
signals; wiring both to one action misfires).

**Fix = DELETE the whole branch** (chrox call). **MERGED 2026-09-05 as `19989d272`**
(PR #6063). The first pass gated it on pointer type
(`isMouseContextMenu`, touch/pen excluded) and that worked, but the shortcut is obsolete:
**the annotation toolbar is unified across EPUB and PDF now**, so PDF right-click should fall
through to the shared path like every other format. The helper was removed with it — no
consumers left. Desktop right-click in a PDF now shows the native menu, exactly as EPUB
already did (`handleContextmenu` only preventDefaults for mobile / touch / pen).

## Device measurements (Xiaomi 13, 368b0948)

| trigger | `pointerType` | `button` |
|---|---|---|
| real long press (`adb shell input touchscreen motionevent DOWN/UP`) | `'touch'` | `-1` |
| CDP `Input.synthesizeTapGesture` duration 900 | `''` (empty!) | `-1` |
| desktop right click | `'mouse'` | `2` |

**`button` is NOT a usable discriminator** and CDP's synthesized gesture reports an empty
`pointerType` — only the `adb input` path produces the `'touch'` a real finger produces. Keep
this table: any future pointer-type gate needs it.

**Neither `adb shell input` nor CDP `Input.dispatchTouchEvent`/`synthesizeTapGesture` can
drive Chrome's native long-press word selection** on this WebView: the `contextmenu` fires but
`getSelection()` stays collapsed, even with the app's handlers blocked by a capture-phase
`stopPropagation`. Injected events reach the DOM but not `SelectWordAroundCaret`. Workaround
used for verification: build the Range in JS, `addRange` it, then dispatch a synthetic
`new PointerEvent('contextmenu', {pointerType, button, bubbles, composed})` on the span — the
app's listener has no `isTrusted` check, so this exercises the real handler. A genuine finger
long press end-to-end was NOT automatable and is the one unverified step.

Before/after on the device (`.popup-container` scrape + screencap), same PDF selection:

```
BEFORE  touch/pen/mouse -> "Original Text | Auto Detect | ..."  (translator, all three)
AFTER   every pointer type -> annotation toolbar + #6031 highlight strip
```

## Regression test

`src/__tests__/components/annotator/AnnotatorLookupSurfaces.test.tsx` — the #6018 harness,
generalized: `h.book = {format, isFixedLayout}` is now switchable and the `useFoliateEvents`
mock captures the handlers so a test can fire `onLoad` and drive the listeners it registers.

**Two traps that made the first version of this test pass against the buggy code** (it was
worthless until both were fixed — always re-run a regression test against HEAD to prove it
goes red):
1. jsdom implements `getSelection` **only on the window's own document**. A
   `document.implementation.createHTMLDocument()` section doc has none, so
   `doc.getSelection?.()` returned undefined and the handler bailed instantly. Pass the
   ambient `document` as `detail.doc`.
2. The `getView()` mock had no `getCFI`, so `view?.getCFI(index, range)` threw inside the
   `.then()` before `setShowDeepLPopup(true)` — swallowed as an unhandled rejection.

## Recipe notes

- `curl` to the CDP endpoint needs `--noproxy '*'` / `NO_PROXY='*'` on this machine — the
  SOCKS proxy from [[git-push-socks-proxy]] swallows `127.0.0.1:9223` otherwise.
- FXL PDF doc coords map to host CSS coords by
  `doc.defaultView.frameElement.getBoundingClientRect()` (scale ~= 1); device px = CSS px
  x 2.75 on this phone, no offset (window is edge-to-edge, 1080x2400 / 2.75 = 392x872 =
  `innerWidth`/`innerHeight`).
- See [[feedback-always-verify-on-xiaomi]] for the socket/forward/deep-link half.
