---
name: persian-rlm-halfspace-zwnj-5651
description: "MERGED PR #5651 — swap misused RLM (U+200F) to ZWNJ (U+200C) in sanitizer for Persian half-space; digit ranges inside U+0600-06FF are the trap"
metadata: 
  node_type: memory
  type: project
  originSessionId: d2cd384a-5293-4e3a-a72d-c5637b96e762
  modified: 2026-08-12T16:13:59.872Z
---

PR #5651 (closes #5216) swaps RLM->ZWNJ in `sanitizer.ts` when RLM sits between two Arabic-block chars. Premise is CORRECT: RLM is Cf/Joining_Type=T (join-transparent, does NOT break cursive joining); ZWNJ is the real Persian half-space. Old Persian keyboards emitted RLM for Shift+Space, hence the misuse in legacy EPUBs. #5216/#5361 only preserved RLM through serialization; rendering stayed broken.

Review findings, FIXED in follow-up commit 1529d2e21 pushed to the PR branch 2026-08-13 (digit ranges excluded, do/while replaced with single run-matching replace, unit tests added, module-scope regex literal; comment posted on PR):
1. Char class `[؀-ۿ...]` INCLUDES digits — U+0660-0669 (bidi AN) and U+06F0-06F9 (bidi EN). RLM (strong R) between two digits splits number runs; ZWNJ (BN, stripped by bidi X9) merges them -> visual digit order flips for `۱‏۲`. Contradicts the code comment's "digits left intact" claim. Fix: exclude digit ranges, and end last range at ﹰ-ﻼ (U+FEFF is the BOM).
2. do/while loop is dead code: lookahead + g-flag replace converges in ONE pass; replacement ZWNJ can't create new matches. Consecutive RLMs (`ا‏‏ب`) are NEVER converted (inner RLM has no letter neighbor) — loop doesn't help.
3. No unit tests despite existing `sanitizerTransformer` describe block in transformers.test.ts.
4. Biome warns: static `new RegExp` -> use regex literal (hoistable).

**Why:** RLM between two Arabic LETTERS is bidi-inert AND join-transparent -> swap is safe there; next to DIGITS it is a live direction hint -> swap corrupts. Any future RTL text-mangling heuristic must treat U+0600-06FF as "Arabic block", not "Arabic letters".

**How to apply:** When reviewing/writing Arabic-script transforms, check bidi classes of the char-class members (letters AL, digits AN/EN, harakat Mn) separately; verify claims with a node repro of the regex before trusting comments. Swap must run AFTER the `&#x200f;`->literal restore chain in sanitizer. Related: [[loaddocument-xhtml-parsererror-5625]].
