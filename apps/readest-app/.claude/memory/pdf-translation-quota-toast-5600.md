---
name: pdf-translation-quota-toast-5600
description: "#5600 quota toast on every PDF selection: the Settings translation switch was ungated while the toolbar toggler was gated, and PDF contextmenu auto-opens TranslatorPopup"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3d6ec81b-0f3c-4332-8d55-a61f290536eb
  modified: 2026-08-10T17:56:30.484Z
---

MERGED #5617 (`28687314b`, 2026-08-10). Reporter saw "Daily translation quota
reached" on **every** text selection in a PDF, having never deliberately
translated anything.

**Two separate mechanisms, don't conflate them:**

1. *What drained the quota.* `isTranslationAvailable()`
   (`src/services/translators/utils.ts`) already excludes PDFs, and the reader
   toolbar's `TranslationToggler` honours it — but Settings > Language >
   Translation > Enable Translation was gated only on `disabled={!bookKey}`.
   Turned on for a PDF, `useTextTranslation` walks the pdf.js text layer and
   translates it paragraph by paragraph.
2. *What re-reports it on every selection.* `Annotator.tsx` registers a
   `contextmenu` listener for `bookData.isFixedLayout` that opens
   `TranslatorPopup` directly, and the popup calls `translate()` on mount with
   no availability check. On Android long-press-to-select fires `contextmenu`,
   so every PDF selection issues a translate request. **Still UNFIXED** — the
   toast is a symptom of this path, not of the setting.

Also **UNFIXED**: `useTextTranslation` obeys `viewSettings.translationEnabled`
alone, so a PDF whose saved config already has it `true` keeps translating
until the user turns it off by hand. The fix only makes sure they can (the
switch stays live when translation is already on, mirroring the toggler's
`!available && !enabled` rule).

**Diagnostic shortcut**: `translationEnabled` is saved with `skipGlobal = true`
at *every* call site, so it never reaches `globalViewSettings` and cannot leak
onto a freshly opened PDF. If a PDF has it on, it was set from the Settings
panel — that was the whole exposure.

Mirror image of [[stale-format-gates-in-settings]]: there a format gate
outlived the limitation, here the gate was simply missing on a sibling surface.
Same audit question either way — when one entry point gates a capability, check
whether its sibling does.

**Chrome verify gotcha**: a non-PDF EPUB can look like a false positive. The
profile's Translate To was `zh-CN` against a `zh` book, so `isSameLang` locked
it correctly; flipping Translate To to `en` unlocked it live. Check the target
language before calling the gate a misfire. Recipe:
[[browser-verify-readest-web-recipe]].
