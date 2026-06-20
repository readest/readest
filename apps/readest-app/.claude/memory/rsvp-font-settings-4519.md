---
name: rsvp-font-settings-4519
description: "RSVP word uses the reader's font face/family via getBaseFontFamily; overlay renders in the top document where fonts are mounted"
metadata: 
  node_type: memory
  type: project
  originSessionId: 18ca3271-7e08-4b4f-bf33-a135370d5844
---

#4519 — RSVP (speed-reading) word display now mirrors the reader's font face/family
settings instead of a hardcoded `font-mono`.

Key facts (non-obvious):
- The RSVP overlay (`RSVPOverlay.tsx`, rendered via `createPortal` to
  `document.body` from `RSVPControl.tsx`) lives in the **top document**, NOT an
  iframe. So it cannot read the iframe's `--serif`/`--sans-serif` CSS variables
  that `getFontStyles` sets. Instead apply a resolved `font-family` string.
- `getBaseFontFamily(viewSettings)` in `src/utils/style.ts` returns the resolved
  body font chain (serif or sans-serif per `defaultFont`, including the chosen
  typeface, `defaultCJKFont`, and any custom font selected as serif/sans). It
  reuses the shared `buildFontFamilyLists` helper extracted from `getFontStyles`.
- This works because fonts are already mounted in the **top document**:
  `FoliateViewer.tsx` calls `mountCustomFont(document, font)` for user-imported
  fonts, and `Reader.tsx` calls `mountAdditionalFonts(document)` for the basic
  Google fonts.
- KNOWN GAP: `Reader.tsx` calls `mountAdditionalFonts(document)` WITHOUT the
  book-language CJK flag, so the built-in CJK *web* fonts (LXGW WenKai, Noto
  Serif JP, etc.) only mount in the top document when `isCJKEnv()` is true. A
  non-CJK-env user reading a CJK book may see a system CJK fallback in the RSVP
  word rather than the exact web font. Latin fonts and user-imported custom
  fonts are unaffected (always mounted). The iframe loads CJK fonts per-doc via
  `mountAdditionalFonts(detail.doc, isCJKLang(...))` regardless of env.
- RSVP keeps its own font *size* control (localStorage `readest_rsvp_fontsize`);
  only face/family were wired up. Font weight is intentionally left as the RSVP
  design (word `font-medium`, ORP char `font-bold`).

Related: [[iframe-cross-realm-instanceof]] (top-realm vs iframe-realm distinction).
