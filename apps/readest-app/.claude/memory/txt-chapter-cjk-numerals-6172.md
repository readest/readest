---
name: txt-chapter-cjk-numerals-6172
description: TXT chapter split lost the WHOLE book's TOC because 两 was missing from the cjkNumber class; one unmatched numeral style trips isGoodMatches
metadata:
  type: project
---

#6172 (Chinese TXT《万国之国》, 10MB, 638 chapters). MERGED #6181 (418a28780) 2026-09-11. Worktree and branch cleaned up.
Not device-verified; the numbers below are from the reporter's real file run
through the converter in vitest.

**The amplifier, not the typo, is the story.** 82 of 638 chapters spell two as
第两百N章. `两` was absent from `cjkNumber` in `src/utils/txt.ts`, so those 82
headings never matched — and because they run contiguously they glued into ONE
445,438-char part. `isGoodMatches` rejects any split containing a part >100k,
so the entire split result was thrown away and all 638 chapters fell back to
paragraph chunking: 532 sections titled "1".."532", zero detected headings.
**A single unrecognized numeral style does not lose its own chapters, it loses
the book.** That fragility is still there for the next missing style.

Fix (3 files): module-level `CJK_NUMBER_DIGITS` (adds 两兩 + 壹贰貳叁叄參肆伍陆陸柒捌玖拾)
/ `CJK_NUMBER_UNITS` (adds 萬佰仟) / `CJK_NUMBER_CHARS`, shared by `cjkNumber`
and the hoisted `CJK_VOLUME_HEADING` (isVolume previously had its own
hand-copied class — keep them one source). Plus `detectLanguage` in
`src/utils/lang.ts`: franc returns `und` for short CJK (`franc('万国之国')==='und'`,
also 三体/こんにちは/한글 제목), and the old `|| 'en'` meant the zh regexps never
ran; now falls through to `inferLangFromScript` (which already existed) before
'en'. Guarded so franc-classified text is never overridden — the existing
"mostly English with some 中文" test still expects en.

Verified on the reporter's real file: before 532 chapters / 0 detected; after
645 chapters / 644 detected, 81 of 82 两 chapters in the TOC, maxPart 17,990,
zero false positives. The 82nd (`第两百五十四 鹰巢的威胁（下）`) is missing 章 in the
source — a typo in the book, out of scope; matching a bare 第N with no unit
would be far too loose. Full suite 11083 pass, lint/tsc/biome clean.

Related: [[bug-patterns]]
