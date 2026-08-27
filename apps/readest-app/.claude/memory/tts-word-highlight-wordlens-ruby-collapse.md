---
name: tts-word-highlight-wordlens-ruby-collapse
description: Word-granularity TTS silently skipped every Word Lens glossed word because expandRangeOverRuby collapsed the CFI over cfi-skip ruby
metadata:
  type: project
---

Word-granularity TTS highlighting skipped every word carrying a Word Lens gloss; sentence granularity was unaffected. Found and fixed 2026-08-27 (Xiaomi 368b0948, "The Sense of Style", Word Lens en->zh on).

**Why:** `expandRangeOverRuby` (`src/utils/ruby.ts`, added for #5539) widened ANY range whose start/end sat inside a `<ruby>`, using `setStartBefore`/`setEndAfter`. Word Lens injects `<ruby class="wl-gloss" cfi-skip><base><rt cfi-inert>gloss</rt></ruby>`, and `cfi-skip` means the element contributes NO CFI step — so before-the-ruby and after-the-ruby resolve to the SAME CFI position and the range COLLAPSES. `TTSController.#getHighlighter` round-trips through `getCFI` -> `resolveCFI().anchor(doc)`, so the overlayer got an empty range and painted nothing. Word ranges land inside the ruby base constantly; sentence ranges almost never start or end inside one, which is exactly why only word granularity lost the glossed words. #5539's real need is the opposite case: a Japanese kana `<rt>` IS the spoken text and the overlayer never paints `<rt>`, so that range must be widened onto the base.

**How to apply:** expansion is now gated on `spokenReadingRuby` — only a range anchored inside an `<rt>` that `isSpokenReading` (kana, not `cfi-inert`) expands. Gloss ruby (Word Lens, pinyin, zhuyin, emphasis dots) is left exact, because there the base is both spoken and paintable. Never widen a range over a `cfi-skip` element and then take a CFI of it.

**Device-proof recipe (no rebuild needed to see the bug):** wrap the live overlayer to log every draw --
`const c = deepQuery('foliate-view')[0].renderer.getContents()[0]; const orig = c.overlayer.add.bind(c.overlayer); c.overlayer.add = (k,r,d,o) => { window.__ttsLog.push({k, text:String(r), collapsed:r.collapsed}); return orig(k,r,d,o); }`
then start TTS. Before the fix: 32/241 draws (13.3%) were `collapsed:true` with empty text, one per glossed word. A cheaper static probe compares the two CFIs directly: plain base range -> `/6/14!/4/2/4[sen...],/1:13,/1:20` resolving to "manuals"; ruby-expanded -> `/6/14!/4/2,/4[sen...],/4[sen...]` resolving to "". Related: [[edge-tts-word-highlighting-4017]], [[feedback-always-verify-on-xiaomi]].
