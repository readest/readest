---
name: txt-chapter-measure-word-4658
description: TXT import detected 第一封信/第四本书 (量词 prose) as chapters; split units into strong vs weak (separator-required)
metadata: 
  node_type: memory
  type: project
  originSessionId: c0199d69-f314-45ee-bf7c-867b908641cc
---

#4658 (目录检测优化): TXT→EPUB chapter detection (`src/utils/txt.ts` `createChapterRegexps('zh')`, first regex) wrongly surfaced prose lines as TOC entries:
- `第一封信。` / `第七封信` (the Nth *letter*) — measure word `封` was a chapter unit.
- `第四本书记载着锤法，来自孙家，可惜对秦铭用处不大了…` (the fourth *book* + full sentence) — measure word `本`.

Root cause: the unit class `[章卷节回讲篇封本册部话]` treated 量词 (measure words) the same as real chapter units, and allowed a title to attach DIRECTLY after the unit (`封信`, `本书`).

Fix = split units into two tiers in the regex:
- **Strong** `[章节回讲篇话]` — may carry an attached title (`第一章天地初开`), unchanged: `(?:[：:、 　\(\)0-9]*[^\n-]{0,36})`.
- **Weak / 量词** `[卷本册部封]` — title MUST be introduced by a separator or the line ends, i.e. the char after the unit must be `[：:、 　\(\)]` (or boundary), never a bare noun: `(?:[：:、 　\(\)][：:、 　\(\)0-9]*[^\n-]{0,36})?`.

So `第一封 致读者` / `第一本 标题` / `第二部 中篇` / `第一卷 起始篇` / standalone `第一本\n` still match (existing tests rely on this); `第一封信` / `第四本书...` do not. Weak set = the same units used by the `isVolume` regex (`卷|本|册|部`) plus `封`. `(?!\S)` end-anchor does the rejection by backtracking when a noun follows. Tests in `__tests__/utils/txt.test.ts` ("measure-word false positives", two e2e). Not touched: 节 (kept strong despite 第三节课 risk — not in scope).
