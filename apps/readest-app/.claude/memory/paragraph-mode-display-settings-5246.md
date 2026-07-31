---
name: paragraph-mode-display-settings-5246
description: "#5246 paragraph mode font size + custom font: RSVP-style config panel on ParagraphBar; scale applied at frame level so 66ch tracks it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 24f4ce68-aa9c-4405-9625-fceed3b04720
  modified: 2026-07-31T05:11:27.658Z
---

Issue #5246 (FR, zh): paragraph mode (Shift+P) text was locked to body size and dropped the user's custom/CJK font. MERGED PR #5403 (2026-07-31, merge f598c9ed6). Low-value tests (constant restatements, default-prop test) removed before commit at user request; kept font-chain, frame-scaling, gear/stepper, auto-hide-gate, and persistence clamp tests.

Two distinct root causes:
1. **Font**: `ParagraphOverlay.contentStyle` built a bare `"serifFont", serif` pair — no `defaultCJKFont`, no fallback chain — so CJK text fell back to the system font. Fix: `getBaseFontFamily(viewSettings)` (same as RSVP overlay), guarded on `viewSettings.defaultFont` because tests pass partial viewSettings.
2. **Size**: added a font-scale stepper (RSVP config-panel pattern): `PARAGRAPH_FONT_SCALE_OPTIONS` [1..5, max 500% per user] + index persisted in localStorage `readest_paragraph_fontsize` (helpers in `utils/paragraphPresentation.ts`); state owned by `ParagraphControl`, gear + panel on `ParagraphBar` (panel reuses the bar card chrome, gates the auto-hide timer via a ref).

**Why:** the frame's `66ch` width cap resolves against the *frame's* font, not the paragraph's — so the scaled `fontSize`/`fontFamily` must ALSO be set on the frame div (the one with `frameStyle`), or bigger text squeezes into the same px-width box instead of widening the column (the reporter's "tiny middle block on a big screen" complaint).

**How to apply:** when scaling text inside a ch/em-capped container, put the font on the container, not just the text. Reused existing i18n keys ('Font Size', 'Settings', 'Decrease/Increase font size') — zh-CN already had them, zero new translations. See [[paragraph-mode-styling-5275]] for the bar/overlay chrome rules.
