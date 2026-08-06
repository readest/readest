---
name: quick-action-dictionary-single-word-5213
description: "#5213 dictionary quick action on long selections falls back to annotation toolbar; isSingleLookupTerm heuristic with 8-char CJK cap"
metadata: 
  node_type: memory
  type: project
  originSessionId: bd78030b-1892-4a7c-8c99-79084f0310bc
  modified: 2026-08-06T05:54:24.128Z
---

Issue #5213 part 1 (part 2, reopening the toolbar after closing a lookup popup, was #5526): the
dictionary quick action fired on any selection length, leaving no way to highlight/copy long text.

Fix (MERGED PR #5529 2026-08-06, closed #5213; worktree and branch cleaned up; verified live in
Chrome web -- single-token drag opened the dict popup, multi-word drag showed the annotation
toolbar; slow CDP `left_click_drag` passes the 300ms quick-action hold gate):

- `isSingleLookupTerm(text)` in `src/utils/word.ts`: trimmed text with any whitespace = multi-token
  reject; non-CJK single token = accept; CJK run = accept only if no `\p{P}|\p{S}` and <= 8 code
  points (covers compounds, 4-char idioms, conjugated Japanese forms; rejects sentences, which have
  no spaces in CJK so segment counts alone can't decide -- Intl.Segmenter splits idioms/conjugations
  into multiple word-likes, hence the length cap instead).
- Wiring: `Annotator.tsx` `handleQuickAction` -> `runAction` `case 'dictionary'` only; falls back to
  `handleShowAnnotPopup()`. Popup positions are already computed earlier in the selection effect, so
  the fallback behaves exactly like the normal no-quick-action path. Android deferral to touchend and
  the iOS/desktop long-press-hold gate stay in front of the fallback. Other quick actions (translate,
  copy, tts, search, share) intentionally untouched -- they make sense on passages.

**Why:** dictionary lookups can't answer phrases; CJK needed a length heuristic, not a word count.
**How to apply:** reuse `isSingleLookupTerm` for any future word-sized-lookup gating (e.g. Word Lens
style features); tune `MAX_CJK_LOOKUP_CHARS` there if CJK users report the cap wrong.
