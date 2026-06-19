---
name: feedback-commit-message-english-only
description: "Commit messages (and PR titles) must be English-only — no CJK characters, no em/en dashes"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c0199d69-f314-45ee-bf7c-867b908641cc
---

Git commit messages must be **English only**: no CJK characters (no 中文/量词/example glyphs like 第一封信) and no em/en dashes (— –). Use plain ASCII punctuation (comma, colon, parentheses, `...`). The same applies to PR titles for consistency.

**Why:** the user (a maintainer of readest/readest) keeps the project's git history English-only and clean.

**How to apply:** when a fix is about Chinese/CJK text, describe the concept in English in the commit subject/body (e.g. "measure-word prose", "the classifiers for 'letter' and 'book'") instead of pasting the glyphs. Keep the concrete CJK examples and screenshots in the PR *body* / code / tests, where they aid understanding — that is fine. First seen on PR #4660 ([[txt-chapter-measure-word-4658]]), where "量词" in the subject had to be amended to "measure-word".
