---
name: rsvp-rtl-word-display-4630
description: RSVP ORP focus-letter split breaks Arabic/RTL shaping; render RTL words whole with dir=rtl
metadata: 
  node_type: memory
  type: project
  originSessionId: 0561d60a-5d21-4b58-8bc9-1295a9f768ce
---

#4630: In RSVP the word window showed Arabic with letters separated, LTR, wrong order (e.g. علم → ل م ع), sometimes a tofu box. Root cause = the ORP focus-letter layout in `RSVPOverlay.tsx` slices each word into `wordBefore`/`orpChar`/`wordAfter` by character index and lays them out in absolutely-positioned LTR spans. Slicing by index breaks Arabic letter shaping (letters stop connecting → isolated/notdef forms) and the before→after LTR layout reverses visual order. The context panel renders each word as ONE unsplit `<span>`, which is why the reporter saw it render correctly there.

Fix: detect RTL and render the word whole, reusing the existing CJK "Highlight Word" `.rsvp-word-whole` branch, with `dir='rtl'` for correct base direction.
- New `isRTLText(text)` in `src/services/rsvp/utils.ts` — `RTL_PATTERN = /[֐-ࣿיִ-﷿ﹰ-﻿]/` (Hebrew/Arabic/Syriac/Thaana/NKo/Samaritan/Mandaic + presentation forms). Mind the literal-char Edit pitfall: bidi reordering made exact-string Edit fail; wrote the regex with `\u` escapes via perl on the line number instead.
- Overlay branch: `isRTLWord || (isCJKWord && highlightWholeWord)` → whole-word span; `dir={isRTLWord ? 'rtl' : undefined}`. No new toggle — RTL always renders whole (ORP anchoring is meaningless for unsplittable shaped scripts).

General lesson: any complex-shaping/bidi script can't survive per-character span splitting; the same trap applies to other features that slice words by index for highlighting. Related: [[rsvp-font-settings-4519]]. jsdom tests assert DOM structure (whole span + dir) only; glyph shaping is a real-browser concern but is guaranteed correct because the sibling context span already shapes correctly.
