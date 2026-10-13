---
name: android-keyboard-adjustpan-sheet-6390
description: "Android soft keyboard vs web bottom sheets - activity is adjust=pan (window-level, invisible to JS), visualViewport jumps once; web-only \"sheet rides the keyboard\" REJECTED by chrox (#6390)"
metadata:
  node_type: memory
  type: project
  originSessionId: 333348ab-bd51-4d88-aa97-a04a8800f0c4
  modified: 2026-09-30T14:48:20.271Z
---

Measured on the Xiaomi 13 while working on #6390 (2026-09-30):

- `dumpsys window` shows the Readest activity with `sim={adjust=pan}`. When the caret starts under the keyboard, **Android pans the whole window** (the WebView moves up). JS cannot see this: `visualViewport.offsetTop` stays 0. Only a screen recording shows it.
- The WebView gets the keyboard as **one step**: `visualViewport.height` 873→535 about 84ms after focus, roughly when the keyboard *starts* its ~190ms decelerating slide. A window `resize` also fires, with `innerWidth`/`innerHeight` unchanged.
- The spurious resize closed FootnotePopup (it dismissed on any resize). The fix, which is kept: dismiss only when `innerWidth` changes.
- Tried: lifting a `Dialog` sheet onto the keyboard with a 200ms CSS glide, plus undoing the pan. It bounced, because Android pans first and then pans back once the caret clears. **chrox chose to revert to a plain 30% sheet** over native `WindowInsetsAnimation` tracking.

**Why:** a web-only fix can't sync with the keyboard or cancel an adjustPan pan.
**How to apply:** don't retry CSS or visualViewport keyboard-following. Exact sync needs native work: switch to adjust-nothing while the sheet is open and send IME insets to JS every frame. Offer that, then ask. Recording recipe: `adb shell screenrecord --time-limit 3`, then `ffmpeg ... select=...,tile=10x3 -fps_mode passthrough` to make a contact sheet. PIL isn't installed.
